#!/usr/bin/env python3
"""Run offline smoke tests for the bundled project scripts."""

from __future__ import annotations

import base64
import argparse
import contextlib
import json
import os
import re
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-hyperframes-check", action="store_true")
    parser.add_argument("--hyperframes-version", default="1.2.3")
    parser.add_argument("--hyperframes-bin", type=Path)
    parser.add_argument("--work-dir", type=Path)
    return parser.parse_args()


def run(
    command: list[str],
    *,
    expect_ok: bool = True,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        command,
        text=True,
        capture_output=True,
        check=False,
        cwd=cwd,
        env=env,
    )
    if expect_ok and completed.returncode:
        raise AssertionError(
            f"命令失败：{' '.join(command)}\n{completed.stdout}\n{completed.stderr}"
        )
    if not expect_ok and completed.returncode == 0:
        raise AssertionError(f"命令本应失败：{' '.join(command)}")
    return completed


def write_wav(path: Path, duration_seconds: float = 2.0) -> None:
    sample_rate = 8000
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * int(sample_rate * duration_seconds))


def main() -> int:
    args = parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.hyperframes_version):
        raise SystemExit("hyperframes-version 必须是精确 X.Y.Z")
    skill_root = Path(__file__).resolve().parent.parent
    scripts = skill_root / "scripts"
    if args.work_dir:
        requested = args.work_dir.expanduser().resolve()
        if requested.exists() and any(requested.iterdir()):
            raise SystemExit(f"work-dir 必须不存在或为空：{requested}")
        requested.mkdir(parents=True, exist_ok=True)
        temp_context = contextlib.nullcontext(str(requested))
    else:
        temp_context = tempfile.TemporaryDirectory(prefix="produce-image-to-video-test-")
    with temp_context as temp_value:
        temp = Path(temp_value)
        project = temp / "sample-project"
        run(
            [
                sys.executable,
                str(scripts / "init_project.py"),
                str(project),
                "--title",
                "通用测试项目",
                "--aspect-ratio",
                "9:16",
                "--width",
                "1080",
                "--height",
                "1920",
                "--mode",
                "hybrid",
            ]
        )

        state_path = project / "video-project.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        assert state["schema_version"] == 2
        assert state["production"]["mode"] == "hybrid"
        assert (project / "work/captions").is_dir()

        script_text = "春天来了。我们继续生活？"
        (project / "narration/script.txt").write_text(script_text, encoding="utf-8")
        audio_path = project / "narration/final-audio.wav"
        write_wav(audio_path)
        for name in ("scene-01.png", "scene-02.png"):
            (project / "images/scenes" / name).write_bytes(PNG_1X1)
        clip_path = project / "inputs/generated-clips/scene-01.mp4"
        run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=32x32:d=1:r=24",
                "-an",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(clip_path),
            ]
        )

        words = {
            "words": [
                {"word": "春天", "start": 0.10, "end": 0.35},
                {"word": "来了", "start": 0.38, "end": 0.68},
                {"word": "我们", "start": 1.05, "end": 1.28},
                {"word": "继续", "start": 1.31, "end": 1.55},
                {"word": "生活", "start": 1.58, "end": 1.88},
            ]
        }
        timing_path = project / "work/captions/words.json"
        timing_path.write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")

        state["intake"].update(
            {
                "goal": "验证通用旁白驱动视频流程",
                "audience": "测试观众",
                "publishing_platform": "测试平台",
                "target_duration_seconds": 2.0,
                "tone": "中性",
                "status": "approved",
            }
        )
        state["narration"].update(
            {
                "script_status": "locked",
                "audio_path": "narration/final-audio.wav",
                "audio_duration_seconds": 2.0,
                "audio_status": "approved",
                "timing_status": "locked",
            }
        )
        state["style_profile"].update(
            {"status": "approved", "name": "通用测试风格", "visual_language": "简洁"}
        )
        state["production"].update({"status": "approved"})
        state["production"]["hyperframes"]["hyperframes_version"] = args.hyperframes_version
        state["captions"].update(
            {"word_timing_path": "work/captions/words.json", "status": "draft"}
        )
        state["scenes"] = [
            {
                "scene_id": "01",
                "narration_text": "春天来了。",
                "visual_goal": "第一个通用场景",
                "timeline_start_seconds": 0,
                "timeline_end_seconds": 1,
                "target_duration_seconds": 1,
                "production_strategy": "external_clip",
                "motion_preset": "push_in",
                "images": [
                    {
                        "path": "images/scenes/scene-01.png",
                        "role": "primary",
                        "status": "approved",
                    }
                ],
                "clip_path": "inputs/generated-clips/scene-01.mp4",
                "clip_status": "user_accepted",
            },
            {
                "scene_id": "02",
                "narration_text": "我们继续生活？",
                "visual_goal": "第二个通用场景",
                "timeline_start_seconds": 1,
                "timeline_end_seconds": 2,
                "target_duration_seconds": 1,
                "production_strategy": "static_image",
                "motion_preset": "pan_left",
                "images": [
                    {
                        "path": "images/scenes/scene-02.png",
                        "role": "primary",
                        "status": "approved",
                    }
                ],
                "clip_path": "",
                "clip_status": "draft",
            },
        ]
        state_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

        align = run(["node", str(scripts / "align_captions.mjs"), str(state_path)])
        align_result = json.loads(align.stdout)
        assert align_result["timingMode"] == "word-offsets-no-global-scale"
        captions_path = project / "work/captions/captions.json"
        captions = json.loads(captions_path.read_text(encoding="utf-8"))
        assert "".join(cue["text"] for cue in captions) == script_text

        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["captions"]["status"] = "locked"
        state_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        validation = run(
            [
                sys.executable,
                str(scripts / "validate_project.py"),
                str(state_path),
                "--stage",
                "compose",
                "--check-files",
            ]
        )
        assert json.loads(validation.stdout)["ok"] is True

        build = run(["node", str(scripts / "build_hyperframes_project.mjs"), str(state_path)])
        build_result = json.loads(build.stdout)
        generated = Path(build_result["output"])
        index_html = (generated / "index.html").read_text(encoding="utf-8")
        assert "element.animate" in index_html
        assert "<script src=" not in index_html
        assert "muted playsinline" in index_html
        assert not any(term in index_html for term in ("case-character", "case-palette", "case-title"))
        package = json.loads((generated / "package.json").read_text(encoding="utf-8"))
        assert f"hyperframes@{args.hyperframes_version}" in package["scripts"]["check"]
        assert (generated / ".generated-by-produce-image-to-video").is_file()
        if args.run_hyperframes_check:
            if args.hyperframes_bin:
                checked = run(
                    [str(args.hyperframes_bin), "check", "--strict", "--json"],
                    cwd=generated,
                )
            else:
                offline_env = dict(os.environ)
                offline_env["npm_config_offline"] = "true"
                checked = run(
                    ["npm", "run", "check", "--", "--strict", "--json"],
                    cwd=generated,
                    env=offline_env,
                )
            json_start = checked.stdout.find("{")
            if json_start < 0:
                raise AssertionError("HyperFrames check 没有返回 JSON")
            check_payload = json.loads(checked.stdout[json_start:])
            assert check_payload["ok"] is True

        run(
            ["node", str(scripts / "build_hyperframes_project.mjs"), str(state_path)],
            expect_ok=False,
        )
        replaced = run(
            [
                "node",
                str(scripts / "build_hyperframes_project.mjs"),
                str(state_path),
                "--replace-generated",
            ]
        )
        replaced_result = json.loads(replaced.stdout)
        assert replaced_result["backup"]
        assert Path(replaced_result["backup"]).is_dir()

        external_project = temp / "external-project"
        run(
            [
                sys.executable,
                str(scripts / "init_project.py"),
                str(external_project),
                "--title",
                "外部路线测试",
                "--mode",
                "external_clips",
            ]
        )
        external_state = json.loads(
            (external_project / "video-project.json").read_text(encoding="utf-8")
        )
        assert external_state["production"]["mode"] == "external_clips"

    print(
        json.dumps(
            {
                "ok": True,
                "checks": [
                    "schema-v2-init",
                    "caption-alignment",
                    "compose-validation",
                    "hyperframes-generation",
                    "hybrid-static-and-external-scenes",
                    *(["hyperframes-check"] if args.run_hyperframes_check else []),
                    "non-overwrite",
                    "recoverable-replace",
                    "external-mode-init",
                ],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
