#!/usr/bin/env python3
"""Validate image-to-video project state and stage readiness."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ALLOWED_MODES = {"undecided", "static_hyperframes", "external_clips", "hybrid"}
ALLOWED_STRATEGIES = {"static_image", "external_clip"}
READY_IMAGE_STATUSES = {"approved", "locked", "auto_validated", "user_accepted"}
READY_CLIP_STATUSES = {"auto_validated", "user_accepted"}
READY_AUDIO_STATUSES = {"approved", "locked", "auto_validated", "user_accepted"}
READY_CAPTION_STATUSES = {"locked", "auto_validated", "user_accepted"}
PUNCTUATION = re.compile(r"[\s，。！？：；、,.?!:;《》“”‘’（）()—…·]")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_file", type=Path)
    parser.add_argument(
        "--stage",
        choices=("setup", "images", "compose", "delivery"),
        default="setup",
    )
    parser.add_argument("--check-files", action="store_true")
    parser.add_argument("--duration-tolerance", type=float, default=0.25)
    return parser.parse_args()


def resolve(project_root: Path, value: str) -> Path:
    path = Path(value).expanduser()
    return path.resolve() if path.is_absolute() else (project_root / path).resolve()


def normalized_content(value: str) -> str:
    return PUNCTUATION.sub("", value)


def scene_images(scene: dict[str, Any]) -> list[dict[str, Any]]:
    images = scene.get("images")
    if isinstance(images, list):
        return [item for item in images if isinstance(item, dict)]
    image_path = scene.get("image_path")
    if isinstance(image_path, str) and image_path:
        return [{"path": image_path, "status": scene.get("image_status", "draft")}]
    return []


def validate_caption_file(
    path: Path,
    *,
    audio_duration: float | None,
    max_glyphs: int | None,
    script_path: Path | None,
) -> list[str]:
    errors: list[str] = []
    try:
        cues = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"无法读取字幕 JSON：{path}：{exc}"]
    if not isinstance(cues, list) or not cues:
        return [f"字幕 JSON 必须是非空数组：{path}"]

    previous_end = -1.0
    ids: set[str] = set()
    texts: list[str] = []
    for index, cue in enumerate(cues, start=1):
        if not isinstance(cue, dict):
            errors.append(f"字幕第 {index} 条不是对象")
            continue
        cue_id = str(cue.get("id", f"cue-{index}"))
        if cue_id in ids:
            errors.append(f"字幕 id 重复：{cue_id}")
        ids.add(cue_id)
        text = cue.get("text")
        try:
            start = float(cue["start"])
            end = float(cue["end"])
        except (KeyError, TypeError, ValueError):
            errors.append(f"字幕 {cue_id} 缺少有效 start/end")
            continue
        if not isinstance(text, str) or not text:
            errors.append(f"字幕 {cue_id} 文本为空")
            continue
        if start < 0 or end <= start:
            errors.append(f"字幕 {cue_id} 时间无效：{start} -> {end}")
        if start < previous_end - 0.001:
            errors.append(f"字幕 {cue_id} 与上一条重叠")
        if audio_duration is not None and end > audio_duration + 0.001:
            errors.append(f"字幕 {cue_id} 越过音频时长")
        if max_glyphs is not None and len(text) > max_glyphs:
            errors.append(f"字幕 {cue_id} 超过 {max_glyphs} 个字符")
        previous_end = max(previous_end, end)
        texts.append(text)

    if script_path and script_path.is_file():
        expected = normalized_content(script_path.read_text(encoding="utf-8"))
        actual = normalized_content("".join(texts))
        if expected != actual:
            errors.append(
                f"字幕有效字符不能重建锁定旁白：字幕 {len(actual)}，旁白 {len(expected)}"
            )
    return errors


def main() -> int:
    args = parse_args()
    project_file = args.project_file.expanduser().resolve()
    if not project_file.is_file():
        raise SystemExit(f"项目状态文件不存在：{project_file}")
    if args.duration_tolerance < 0:
        raise SystemExit("duration-tolerance 不能为负数")

    try:
        state = json.loads(project_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"项目状态不是有效 JSON：{exc}") from exc

    project_root = project_file.parent
    errors: list[str] = []
    warnings: list[str] = []
    schema_version = state.get("schema_version")
    if schema_version not in {1, 2}:
        errors.append(f"不支持 schema_version：{schema_version!r}")

    project = state.get("project")
    if not isinstance(project, dict):
        errors.append("缺少 project 对象")
        project = {}
    for field in ("title", "language", "aspect_ratio"):
        if not isinstance(project.get(field), str) or not project.get(field):
            errors.append(f"project.{field} 不能为空")
    for field in ("width", "height", "fps"):
        value = project.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            errors.append(f"project.{field} 必须为正整数")

    if schema_version == 1:
        mode = "external_clips"
        warnings.append("schema v1 按 external_clips 兼容读取；未修改状态文件")
        production: dict[str, Any] = {}
    else:
        production_value = state.get("production")
        production = production_value if isinstance(production_value, dict) else {}
        if not production:
            errors.append("schema v2 缺少 production 对象")
        mode = production.get("mode", "undecided")
        if mode not in ALLOWED_MODES:
            errors.append(f"production.mode 无效：{mode!r}")

    narration_value = state.get("narration")
    narration = narration_value if isinstance(narration_value, dict) else {}
    if not narration:
        errors.append("缺少 narration 对象")

    script_value = narration.get("script_path", "")
    script_path = resolve(project_root, script_value) if script_value else None
    audio_value = narration.get("audio_path", "")
    audio_path = resolve(project_root, audio_value) if audio_value else None
    audio_duration_value = narration.get("audio_duration_seconds")
    try:
        audio_duration = (
            float(audio_duration_value) if audio_duration_value is not None else None
        )
    except (TypeError, ValueError):
        errors.append("narration.audio_duration_seconds 必须是数字或 null")
        audio_duration = None
    if audio_duration is not None and audio_duration <= 0:
        errors.append("narration.audio_duration_seconds 必须为正数")

    if args.check_files:
        if script_path is None or not script_path.is_file():
            errors.append(f"旁白文件不存在：{script_path}")
        if args.stage in {"compose", "delivery"} and (
            audio_path is None or not audio_path.is_file()
        ):
            errors.append(f"音频文件不存在：{audio_path}")

    scenes_value = state.get("scenes")
    scenes = scenes_value if isinstance(scenes_value, list) else []
    if args.stage in {"images", "compose", "delivery"} and not scenes:
        errors.append("当前阶段要求至少一个场景")
    if args.stage in {"images", "compose", "delivery"}:
        style_value = state.get("style_profile")
        style = style_value if isinstance(style_value, dict) else {}
        if style.get("status") not in READY_IMAGE_STATUSES:
            errors.append("当前阶段要求视觉风格已批准")

    scene_ids: set[str] = set()
    previous_end: float | None = None
    final_end: float | None = None
    transition_duration = 0.0
    if schema_version == 2:
        hf = production.get("hyperframes")
        if isinstance(hf, dict):
            transition = hf.get("transition")
            if isinstance(transition, dict):
                try:
                    transition_duration = float(transition.get("duration_seconds", 0.0))
                except (TypeError, ValueError):
                    errors.append("production.hyperframes.transition.duration_seconds 无效")

    for index, raw_scene in enumerate(scenes, start=1):
        if not isinstance(raw_scene, dict):
            errors.append(f"场景第 {index} 项不是对象")
            continue
        scene_id = str(raw_scene.get("scene_id", ""))
        if not scene_id:
            errors.append(f"场景第 {index} 项缺少 scene_id")
        elif scene_id in scene_ids:
            errors.append(f"scene_id 重复：{scene_id}")
        scene_ids.add(scene_id)

        try:
            start = float(raw_scene["timeline_start_seconds"])
            end = float(raw_scene["timeline_end_seconds"])
            target = float(raw_scene.get("target_duration_seconds", end - start))
        except (KeyError, TypeError, ValueError):
            errors.append(f"scene-{scene_id or index} 缺少有效时间线")
            continue
        if start < 0 or end <= start or target <= 0:
            errors.append(f"scene-{scene_id or index} 时间线无效")
        if abs((end - start) - target) > args.duration_tolerance:
            errors.append(f"scene-{scene_id or index} target_duration 与起止时间不一致")
        if previous_end is not None:
            delta = start - previous_end
            if abs(delta) > args.duration_tolerance:
                errors.append(
                    f"scene-{scene_id or index} 与上一幕存在 {delta:+.3f}s 的空隙或重叠"
                )
        previous_end = end
        final_end = end

        strategy = raw_scene.get("production_strategy")
        if mode == "static_hyperframes":
            strategy = strategy or "static_image"
            if strategy != "static_image":
                errors.append(f"scene-{scene_id} 与 static_hyperframes 模式冲突")
        elif mode == "external_clips":
            strategy = strategy or "external_clip"
            if strategy != "external_clip":
                errors.append(f"scene-{scene_id} 与 external_clips 模式冲突")
        elif mode == "hybrid" and strategy not in ALLOWED_STRATEGIES:
            errors.append(f"scene-{scene_id} 必须明确 production_strategy")

        needs_images = args.stage == "images" or strategy == "static_image"
        if args.stage in {"images", "compose", "delivery"} and needs_images:
            images = scene_images(raw_scene)
            if not images:
                errors.append(f"scene-{scene_id} 没有静态图片")
            for image_index, image in enumerate(images, start=1):
                path_value = image.get("path")
                status = image.get("status", "draft")
                if not isinstance(path_value, str) or not path_value:
                    errors.append(f"scene-{scene_id} 图片 {image_index} 缺少路径")
                    continue
                if status not in READY_IMAGE_STATUSES:
                    errors.append(
                        f"scene-{scene_id} 图片 {image_index} 尚未批准：{status!r}"
                    )
                if args.check_files and not resolve(project_root, path_value).is_file():
                    errors.append(
                        f"scene-{scene_id} 图片不存在：{resolve(project_root, path_value)}"
                    )

        if args.stage in {"compose", "delivery"} and strategy == "external_clip":
            clip_value = raw_scene.get("clip_path", "")
            clip_status = raw_scene.get("clip_status", "draft")
            if clip_status not in READY_CLIP_STATUSES:
                errors.append(f"scene-{scene_id} 外部片段未通过门禁：{clip_status!r}")
            if not isinstance(clip_value, str) or not clip_value:
                errors.append(f"scene-{scene_id} 缺少 clip_path")
            elif args.check_files and not resolve(project_root, clip_value).is_file():
                errors.append(f"scene-{scene_id} 片段不存在：{resolve(project_root, clip_value)}")

    if scenes and final_end is not None and audio_duration is not None:
        if abs(final_end - audio_duration) > args.duration_tolerance:
            errors.append(
                f"场景结尾 {final_end:.3f}s 与音频 {audio_duration:.3f}s 不一致"
            )
    if scenes:
        first_start = scenes[0].get("timeline_start_seconds") if isinstance(scenes[0], dict) else None
        try:
            if abs(float(first_start)) > args.duration_tolerance:
                warnings.append("第一幕没有从 0 秒附近开始")
        except (TypeError, ValueError):
            pass

    if args.stage in {"compose", "delivery"}:
        if mode == "undecided":
            errors.append("合成前必须确认 production.mode")
        if schema_version == 2 and production.get("status") not in READY_IMAGE_STATUSES:
            errors.append("合成前 production.status 必须已批准")
        if narration.get("script_status") != "locked":
            errors.append("合成前旁白必须 locked")
        if narration.get("audio_status") not in READY_AUDIO_STATUSES:
            errors.append("合成前音频必须批准或验证")
        if narration.get("timing_status") != "locked":
            errors.append("合成前场景时序必须 locked")

        if mode in {"static_hyperframes", "hybrid"} and schema_version == 2:
            hf = production.get("hyperframes")
            hf = hf if isinstance(hf, dict) else {}
            version = hf.get("hyperframes_version", "")
            if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
                errors.append("production.hyperframes.hyperframes_version 必须是精确 X.Y.Z")
            if transition_duration < 0:
                errors.append("HyperFrames 转场时长不能为负数")

        captions_value = state.get("captions")
        captions = captions_value if isinstance(captions_value, dict) else {}
        if captions.get("enabled", False):
            if captions.get("status") not in READY_CAPTION_STATUSES:
                errors.append("合成前字幕必须 locked、auto_validated 或 user_accepted")
            caption_path_value = captions.get("output_json_path", "")
            caption_path = (
                resolve(project_root, caption_path_value) if caption_path_value else None
            )
            if args.check_files and (caption_path is None or not caption_path.is_file()):
                errors.append(f"字幕 JSON 不存在：{caption_path}")
            elif caption_path and caption_path.is_file():
                policy = captions.get("policy")
                policy = policy if isinstance(policy, dict) else {}
                max_value = policy.get("max_glyphs_per_cue")
                max_glyphs = int(max_value) if isinstance(max_value, int) else None
                errors.extend(
                    validate_caption_file(
                        caption_path,
                        audio_duration=audio_duration,
                        max_glyphs=max_glyphs,
                        script_path=script_path,
                    )
                )

            style = captions.get("style")
            style = style if isinstance(style, dict) else {}
            font_value = style.get("font_file", "")
            if font_value and args.check_files and not resolve(project_root, font_value).is_file():
                errors.append(f"字幕字体文件不存在：{resolve(project_root, font_value)}")
            if not font_value:
                warnings.append("字幕未固定项目字体；跨机器渲染可能存在排版差异")

    if args.stage == "delivery":
        delivery_value = state.get("delivery")
        delivery = delivery_value if isinstance(delivery_value, dict) else {}
        output_value = delivery.get("output_path", "")
        if not delivery.get("rendered", delivery.get("assembled", False)):
            errors.append("交付阶段要求成片已渲染或已合成")
        if not delivery.get("auto_validated", False):
            errors.append("交付阶段要求成片自动验证通过")
        if args.check_files and (
            not output_value or not resolve(project_root, output_value).is_file()
        ):
            errors.append(f"最终成片不存在：{resolve(project_root, output_value) if output_value else None}")

    result = {
        "ok": not errors,
        "schema_version": schema_version,
        "mode": mode,
        "stage": args.stage,
        "scene_count": len(scenes),
        "errors": errors,
        "warnings": warnings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
