#!/usr/bin/env python3
"""Validate media streams, duration, decoding, and optional frame variation."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("media", type=Path)
    parser.add_argument("--decode", action="store_true")
    parser.add_argument("--count-unique-frames", action="store_true")
    parser.add_argument("--expect-width", type=int)
    parser.add_argument("--expect-height", type=int)
    parser.add_argument("--expect-duration", type=float)
    parser.add_argument("--duration-tolerance", type=float, default=0.25)
    parser.add_argument("--require-audio", action="store_true")
    parser.add_argument("--forbid-audio", action="store_true")
    return parser.parse_args()


def require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SystemExit(f"缺少必需命令：{name}")
    return path


def run(command: list[str], *, capture: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=False,
        text=True,
        stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def main() -> int:
    args = parse_args()
    media = args.media.expanduser().resolve()
    if not media.is_file():
        raise SystemExit(f"媒体文件不存在：{media}")
    if args.require_audio and args.forbid_audio:
        raise SystemExit("不能同时要求和禁止音轨")

    ffprobe = require_binary("ffprobe")
    ffmpeg = require_binary("ffmpeg")
    probe = run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=filename,duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels",
            "-of",
            "json",
            str(media),
        ]
    )
    if probe.returncode:
        raise SystemExit(probe.stderr.strip() or "ffprobe 检查失败")

    result = json.loads(probe.stdout)
    streams = result.get("streams", [])
    video_streams = [stream for stream in streams if stream.get("codec_type") == "video"]
    audio_streams = [stream for stream in streams if stream.get("codec_type") == "audio"]
    failures: list[str] = []

    if not video_streams:
        failures.append("缺少视频流")
    else:
        video = video_streams[0]
        if args.expect_width is not None and video.get("width") != args.expect_width:
            failures.append(f"宽度为 {video.get('width')}，预期 {args.expect_width}")
        if args.expect_height is not None and video.get("height") != args.expect_height:
            failures.append(f"高度为 {video.get('height')}，预期 {args.expect_height}")

    duration = float(result.get("format", {}).get("duration", 0.0))
    if args.expect_duration is not None:
        delta = abs(duration - args.expect_duration)
        if delta > args.duration_tolerance:
            failures.append(
                f"时长为 {duration:.3f}s，预期 {args.expect_duration:.3f}s，偏差 {delta:.3f}s"
            )
    if args.require_audio and not audio_streams:
        failures.append("缺少必需音轨")
    if args.forbid_audio and audio_streams:
        failures.append("存在不应有的音轨")

    if args.decode:
        decoded = run([ffmpeg, "-v", "error", "-i", str(media), "-f", "null", "-"])
        if decoded.returncode:
            failures.append(decoded.stderr.strip() or "完整解码失败")
        result["decode_ok"] = decoded.returncode == 0

    if args.count_unique_frames and video_streams:
        hashes: set[str] = set()
        process = subprocess.Popen(
            [ffmpeg, "-v", "error", "-i", str(media), "-an", "-f", "framemd5", "-"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        assert process.stdout is not None
        for line in process.stdout:
            if line.startswith("#") or "," not in line:
                continue
            checksum = line.rsplit(",", 1)[-1].strip()
            if checksum:
                hashes.add(hashlib.sha256(checksum.encode("ascii")).hexdigest())
        stderr = process.stderr.read() if process.stderr else ""
        if process.wait() != 0:
            failures.append(stderr.strip() or "帧变化检查失败")
        result["unique_decoded_frames"] = len(hashes)

    result["validation"] = {"ok": not failures, "failures": failures}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
