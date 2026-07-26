#!/usr/bin/env python3
"""Normalize and assemble approved clips from video-project.json."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_file", type=Path)
    parser.add_argument("--allow-duration-mismatch", action="store_true")
    parser.add_argument("--duration-tolerance", type=float, default=0.25)
    return parser.parse_args()


def require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SystemExit(f"缺少必需命令：{name}")
    return path


def run(command: list[str]) -> None:
    completed = subprocess.run(command, check=False, text=True, capture_output=True)
    if completed.returncode:
        raise SystemExit(completed.stderr.strip() or f"命令失败：{' '.join(command)}")


def probe_duration(ffprobe: str, path: Path) -> float:
    completed = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        check=False,
        text=True,
        capture_output=True,
    )
    if completed.returncode:
        raise SystemExit(completed.stderr.strip() or f"无法读取时长：{path}")
    return float(completed.stdout.strip())


def resolve(project_root: Path, value: str) -> Path:
    path = Path(value).expanduser()
    return path.resolve() if path.is_absolute() else (project_root / path).resolve()


def concat_entry(path: Path) -> str:
    value = path.as_posix()
    if "'" in value:
        raise SystemExit(f"路径包含单引号，当前 ffmpeg 拼接清单不支持：{path}")
    return f"file '{value}'\n"


def main() -> int:
    args = parse_args()
    project_file = args.project_file.expanduser().resolve()
    if not project_file.is_file():
        raise SystemExit(f"项目状态文件不存在：{project_file}")

    ffmpeg = require_binary("ffmpeg")
    ffprobe = require_binary("ffprobe")
    project_root = project_file.parent
    state = json.loads(project_file.read_text(encoding="utf-8"))
    settings = state["project"]
    width = int(settings["width"])
    height = int(settings["height"])
    fps = int(settings["fps"])
    scenes = state.get("scenes", [])
    if not scenes:
        raise SystemExit("项目没有场景")

    normalized_dir = project_root / "work" / "normalized"
    normalized_dir.mkdir(parents=True, exist_ok=True)
    normalized: list[Path] = []
    total_duration = 0.0

    for index, scene in enumerate(scenes, start=1):
        status = scene.get("clip_status")
        if status not in {"auto_validated", "user_accepted"}:
            raise SystemExit(f"scene-{index:02d} 尚未通过片段门禁：{status!r}")
        clip_value = scene.get("clip_path")
        target = float(scene.get("target_duration_seconds", 0.0))
        if not clip_value or target <= 0:
            raise SystemExit(f"scene-{index:02d} 缺少片段路径或有效目标时长")
        clip = resolve(project_root, clip_value)
        if not clip.is_file():
            raise SystemExit(f"片段不存在：{clip}")

        source_duration = probe_duration(ffprobe, clip)
        filters = [
            f"scale={width}:{height}:force_original_aspect_ratio=decrease",
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2",
            f"fps={fps}",
            "format=yuv420p",
        ]
        if target > source_duration:
            filters.append(f"tpad=stop_mode=clone:stop_duration={target - source_duration:.6f}")

        output = normalized_dir / f"scene-{index:02d}.mp4"
        run(
            [
                ffmpeg,
                "-y",
                "-v",
                "error",
                "-i",
                str(clip),
                "-t",
                f"{target:.6f}",
                "-an",
                "-vf",
                ",".join(filters),
                "-c:v",
                "libx264",
                "-crf",
                "18",
                "-preset",
                "medium",
                str(output),
            ]
        )
        normalized.append(output)
        total_duration += target

    concat_path = project_root / "work" / "concat.txt"
    concat_path.parent.mkdir(parents=True, exist_ok=True)
    concat_path.write_text(
        "".join(concat_entry(path) for path in normalized),
        encoding="utf-8",
    )
    visual_path = project_root / "work" / "visual.mp4"
    run(
        [
            ffmpeg,
            "-y",
            "-v",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_path),
            "-c",
            "copy",
            str(visual_path),
        ]
    )

    output_path = resolve(project_root, state["delivery"]["output_path"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    audio_value = state.get("narration", {}).get("audio_path", "")
    if audio_value:
        audio_path = resolve(project_root, audio_value)
        if not audio_path.is_file():
            raise SystemExit(f"旁白音频不存在：{audio_path}")
        audio_duration = probe_duration(ffprobe, audio_path)
        delta = abs(audio_duration - total_duration)
        if delta > args.duration_tolerance and not args.allow_duration_mismatch:
            raise SystemExit(
                f"旁白 {audio_duration:.3f}s 与镜头总时长 {total_duration:.3f}s 相差 {delta:.3f}s；"
                "请先修正镜头时序，或显式使用 --allow-duration-mismatch"
            )
        run(
            [
                ffmpeg,
                "-y",
                "-v",
                "error",
                "-i",
                str(visual_path),
                "-i",
                str(audio_path),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-shortest",
                "-movflags",
                "+faststart",
                str(output_path),
            ]
        )
    else:
        shutil.copy2(visual_path, output_path)

    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
