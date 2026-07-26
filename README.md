# produce-image-to-video

一个通用的 Codex 图生视频制作 Skill。它把中文旁白、视觉风格、Image Gen 分镜、外部图生视频、素材验收、音频同步、字幕与本地合成组织成带确认门禁的完整流程。

## 能做什么

- 用中文澄清主题、受众、平台、画幅、时长和语气，并提供带理由的推荐方案。
- 支持“先写旁白”和“已有音频”两种入口。
- 使用 Codex 当前任务中的 Image Gen 生成风格样片、主体锚点和分镜图。
- 为每个镜头生成平台中立的中文图生视频提示词。
- 允许用户自行选择任意外部图生视频平台，并逐幕保存、检查和返工片段。
- 使用 FFmpeg 统一片段规格、裁切或补帧、拼接视频并合入旁白。
- 区分自动检查、人工视觉确认、合成完成与最终验收，不把文件存在等同于制作完成。

## 工作流

```text
需求确认
→ 旁白初稿
→ 风格确认
→ 主体锚点确认
→ 代表性分镜确认
→ 全部分镜确认
→ 锁定旁白并取得最终音频
→ 按真实音频锁定镜头时序
→ 用户在外部平台逐幕生成视频
→ 单幕检查与返工
→ 拼接、旁白、字幕
→ 自动验证与用户最终确认
```

Skill 会在影响内容、视觉、成本或工作量的关键节点向用户提问。每次只询问当前阶段必要的问题，给出 2～3 个互斥方案和一个推荐方案，同时保留用户自定义选择。

## 依赖

基础流程需要：

- Python 3.9 或更高版本，仅使用标准库。
- `ffmpeg` 和 `ffprobe`，用于媒体检查与本地合成。
- 当前 Codex 任务实际提供的 Image Gen 能力，用于生图。
- 用户选择的外部图生视频平台，用于把分镜图片生成动态片段。
- 用户提供或录制的最终旁白音频。

不需要 Node.js、HyperFrames 或 Remotion。只有在项目需要复杂动态排版、数据可视化或可复用动效模板时，才建议把它们作为可选后期方案。

## 安装

### 安装前准备

确认本机已有 Python 3.9 或更高版本、FFmpeg 和 FFprobe：

```bash
python3 --version
ffmpeg -version
ffprobe -version
```

macOS 缺少 FFmpeg 时，可以使用 Homebrew 安装：

```bash
brew install ffmpeg
```

### 方式一：直接克隆到 Codex Skills 目录（推荐）

以下命令要求目标目录当前不存在：

```bash
mkdir -p ~/.codex/skills
git clone --depth 1 git@github.com:itstarts/produce-image-to-video.git \
  ~/.codex/skills/produce-image-to-video
```

如果 GitHub 仓库为 Private，需要先为 SSH 配置有权访问该仓库的凭据。

### 方式二：保留开发仓库并建立链接

需要经常更新或参与开发时，可以保留 Git 仓库，再将它链接到 Codex Skills 目录。以下命令要求两个目标路径当前都不存在：

```bash
mkdir -p ~/Workspace/skills ~/.codex/skills
git clone git@github.com:itstarts/produce-image-to-video.git \
  ~/Workspace/skills/produce-image-to-video
ln -s ~/Workspace/skills/produce-image-to-video \
  ~/.codex/skills/produce-image-to-video
```

### 验证安装

运行 Codex 自带的 Skill 校验器：

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  ~/.codex/skills/produce-image-to-video
```

看到 `Skill is valid!` 表示目录结构和 `SKILL.md` 格式有效。安装或更新后请新建一个 Codex 任务，让 Codex 重新加载 Skill 清单。

## 使用方式

在新的 Codex 任务中调用：

```text
$produce-image-to-video
```

首次创建视频项目时，也可以从仓库或已安装目录直接运行初始化脚本：

```bash
python3 ~/.codex/skills/produce-image-to-video/scripts/init_project.py \
  /绝对路径/视频项目目录 \
  --title "项目名称"
```

脚本会创建通用目录结构和 `video-project.json`，不会覆盖已有项目文件。

## 更新

直接克隆到 Codex Skills 目录时，运行：

```bash
git -C ~/.codex/skills/produce-image-to-video pull --ff-only
```

使用“保留开发仓库并建立链接”方式安装时，更新源码仓库：

```bash
git -C ~/Workspace/skills/produce-image-to-video pull --ff-only
```

更新完成后同样需要新建 Codex 任务。

## 卸载

使用可恢复方式将已安装目录或符号链接移入废纸篓：

```bash
mv ~/.codex/skills/produce-image-to-video \
  ~/.Trash/produce-image-to-video
```

如果使用源码链接方式，这条命令只会移动符号链接，不会删除 `~/Workspace/skills/produce-image-to-video` 中的 Git 仓库。新建 Codex 任务后，Skill 将不再出现在可用列表中。

## 项目状态

`video-project.json` 记录：

- 项目规格与发布目标
- 已确认的创意选择
- 旁白文字、音频与锁定状态
- 视觉风格配置
- 各幕图片、提示词、时长、片段路径与验收状态
- 最终输出及自动/人工验收状态

不要跳过状态门禁。图片已生成、图片已确认、视频片段已保存、自动检查通过和用户人工接受是不同状态。

## 媒体检查

检查单个视频的解码情况和画面变化：

```bash
python3 scripts/validate_media.py /路径/scene-01.mp4 \
  --decode \
  --count-unique-frames
```

也可以校验分辨率、时长和音轨：

```bash
python3 scripts/validate_media.py /路径/final.mp4 \
  --decode \
  --expect-width 1920 \
  --expect-height 1080 \
  --expect-duration 60 \
  --require-audio
```

唯一帧数量只能排除完全静止的文件，不能代替对抖动、变形、错误动作和画面质量的人工检查。

## 合成视频

当全部场景已经通过片段门禁，而且 `video-project.json` 中的镜头时长和旁白音频已经锁定后，运行：

```bash
python3 scripts/assemble_video.py /绝对路径/视频项目/video-project.json
```

该脚本会：

1. 按项目规格统一分辨率和帧率；
2. 按目标时长裁切，必要时使用结尾静帧补足；
3. 按场景顺序拼接视频；
4. 检查旁白和镜头总时长差异；
5. 合入旁白并输出基础成片。

当前基础合成脚本不会自动烧录字幕。Skill 流程会根据锁定旁白和真实停顿生成字幕，再使用 FFmpeg 完成无背景字幕的后期处理。

## 目录结构

```text
produce-image-to-video/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── assets/
│   └── project-template.json
├── references/
│   ├── decision-protocol.md
│   ├── image-and-style.md
│   ├── project-state.md
│   ├── quality-gates.md
│   ├── video-prompts.md
│   └── workflow.md
└── scripts/
    ├── assemble_video.py
    ├── init_project.py
    └── validate_media.py
```

## 重要边界

- Image Gen 是否可用以当前任务的实际工具列表为准。
- 未经用户单独批准，不切换到需要 API Key 或可能计费的生图路径。
- 外部图生视频由用户手动操作，Skill 不绑定任何单一平台。
- 未经授权，不上传或发布成片，不增加音乐、音效或付费服务。
- 自动验证通过不代表视觉质量已经由用户接受。

## 许可证

当前仓库未附带开源许可证。获得明确许可前，请勿将其视为可自由再分发的软件。
