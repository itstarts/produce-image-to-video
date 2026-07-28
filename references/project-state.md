# 项目状态

## 默认结构

```text
project/
├── video-project.json
├── narration/
│   ├── script.txt
│   └── final-audio.*
├── images/
│   ├── style/
│   ├── anchors/
│   └── scenes/
├── inputs/
│   └── generated-clips/
├── work/
│   ├── captions/
│   ├── hyperframes/
│   ├── normalized/
│   └── review/
└── outputs/
```

允许自定义目录，但状态文件必须记录实际路径。相对路径以 `video-project.json` 所在目录为基准。

## Schema v2

- `project`：标题、语言、画幅、宽高和帧率。
- `intake`：目标、观众、平台、时长、语气和确认状态。
- `decisions`：只记录最终确认的关键选择。
- `narration`：入口方式、旁白路径与状态、音频路径与真实时长、时序状态。
- `style_profile`：当前批准的视觉约束和参考图。
- `production.mode`：`undecided`、`static_hyperframes`、`external_clips` 或 `hybrid`。
- `production.external`：外部平台、操作方式、输出目录和命名规则。
- `production.hyperframes`：项目目录、精确 CLI 版本、转场、背景和运动配置。
- `captions`：词级时间、输出路径、内容策略、视觉样式和状态。
- `scenes`：语义目标、时间线、静态图片、外部片段、逐幕策略和门禁状态。
- `delivery`：合成、检查、预览、渲染、自动验证和人工接受状态。

## 场景结构

推荐每幕使用以下字段；未进入的路线字段可保留为空：

```json
{
  "scene_id": "01",
  "narration_text": "本幕对应的锁定旁白",
  "visual_goal": "本幕唯一的主要视觉信息",
  "timeline_start_seconds": 0,
  "timeline_end_seconds": 8.4,
  "target_duration_seconds": 8.4,
  "production_strategy": "static_image",
  "motion_preset": "auto",
  "images": [
    {
      "path": "images/scenes/scene-01.png",
      "role": "primary",
      "status": "approved",
      "object_position": "50% 50%"
    }
  ],
  "clip_path": "",
  "clip_status": "draft"
}
```

`production_strategy` 只允许 `static_image` 或 `external_clip`：

- `static_hyperframes` 的所有场景必须为 `static_image`。
- `external_clips` 的所有场景必须为 `external_clip`。
- `hybrid` 必须逐幕明确选择。

一幕可以有多张图。未指定 `start_offset_seconds` 和 `duration_seconds` 时，HyperFrames 生成器在该幕内等分图片时长；需要精确节奏时显式填写二者。

## 状态值

使用明确状态，不使用模糊的 `done`：

```text
draft
awaiting_user
file_received
approved
locked
auto_validated
user_accepted
rejected
```

图片已生成、图片已批准、片段已保存、片段自动验证、片段人工接受、字幕已生成、字幕已校时、合成已检查、成片已渲染和用户最终接受必须分别记录。

## Schema v1 兼容

- 读取 v1 时把 `video_generation` 视为旧外部片段配置，把 `production.mode` 视为 `external_clips`。
- 不因读取旧项目而自动重写状态文件。
- 只有用户选择新模式或明确要求迁移时才写入 schema v2；迁移前保留原文件或生成新版本。
- `assemble_video.py` 继续接受旧场景的 `clip_path`、`clip_status` 和 `target_duration_seconds`。

## 路径和覆盖规则

- 项目内路径优先使用相对路径。
- 已批准图片和用户片段不覆盖；修订使用 `-v2`、`-v3` 并更新引用。
- HyperFrames 生成目录已含文件时默认拒绝写入。需要重建时使用新的目录；只有明确使用可恢复替换参数时，才把旧生成目录移动为编号备份。
- 最终成片先写新文件并验证，再更新 `delivery.output_path`；不要用未验证结果覆盖已验收成片。
