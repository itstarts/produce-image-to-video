#!/usr/bin/env python3
"""Initialize a non-destructive image-to-video project directory."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


DIRECTORIES = (
    "narration",
    "images/style",
    "images/anchors",
    "images/scenes",
    "inputs/generated-clips",
    "work/captions",
    "work/hyperframes",
    "work/normalized",
    "work/review",
    "outputs",
)

PRODUCTION_MODES = (
    "undecided",
    "static_hyperframes",
    "external_clips",
    "hybrid",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_dir", type=Path)
    parser.add_argument("--title", required=True)
    parser.add_argument("--aspect-ratio", default="16:9")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--language", default="zh-CN")
    parser.add_argument("--mode", choices=PRODUCTION_MODES, default="undecided")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_dir = args.project_dir.expanduser().resolve()
    state_path = project_dir / "video-project.json"
    narration_path = project_dir / "narration" / "script.txt"

    if state_path.exists():
        raise SystemExit(f"拒绝覆盖已有状态文件：{state_path}")
    if narration_path.exists():
        raise SystemExit(f"拒绝覆盖已有旁白文件：{narration_path}")
    if args.width <= 0 or args.height <= 0 or args.fps <= 0:
        raise SystemExit("width、height 和 fps 必须为正数")

    project_dir.mkdir(parents=True, exist_ok=True)
    for relative in DIRECTORIES:
        (project_dir / relative).mkdir(parents=True, exist_ok=True)

    template_path = Path(__file__).resolve().parent.parent / "assets" / "project-template.json"
    state = json.loads(template_path.read_text(encoding="utf-8"))
    state["project"].update(
        {
            "title": args.title,
            "aspect_ratio": args.aspect_ratio,
            "width": args.width,
            "height": args.height,
            "fps": args.fps,
            "language": args.language,
        }
    )
    state["production"]["mode"] = args.mode

    state_path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    narration_path.touch(exist_ok=False)
    print(state_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
