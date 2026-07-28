---
name: produce-image-to-video
description: 编排通用的旁白驱动视觉视频项目：从中文文案或已有音频出发，使用 Codex 内置 Image Gen 制定风格、建立角色或产品锚点、生成分镜图，并在三种制作路线中选择静态图片加 HyperFrames 确定性运镜、外部图生视频片段或两者混合；随后完成素材验收、旁白同步、字幕、合成、预览和最终验证。用于故事、科普、产品、人物、纪录片、文学解读和编辑型短视频；不绑定题材、画风、外部平台或单一视频框架。
---

# Produce Image To Video

把 Codex 作为制片协调者。统一管理需求、旁白、视觉锚点、分镜、制作路线、字幕、合成、验证和恢复状态；把需要审美或业务判断的决定留给用户，把易错且可重复的机械步骤交给脚本。

## 核心规则

- 默认使用中文沟通和写提示词；文件名、路径、模型、平台参数及代码标识符可保留英文。
- 不固定题材、风格、镜头数、图片密度、外部平台、片段时长、字幕标点或输出目录。任何既有项目只作为证据，不作为默认模板内容。
- 不把推荐当作批准。内容方向、旁白、风格、身份锚点、代表性分镜、制作模式、字幕风格、最终预览和瑕疵取舍需要用户明确确认。
- 每次只问当前阶段必需的 1～3 个问题，提供互斥方案、推荐及依据，并允许用户自定义。读取 [references/decision-protocol.md](references/decision-protocol.md)。
- 先确认风格和身份锚点，再生成代表性分镜；代表性分镜通过后才批量生图。
- Image Gen 的可用性以当前任务工具列表为准。没有内置 Image Gen 时明确说明，未经单独批准不切换到需要 API Key 或可能计费的路径。
- 每个不同分镜使用独立 Image Gen 调用；不要用一个多变体请求代替多场景生成。
- 不覆盖已批准素材或人工修改过的合成项目。使用新版本路径，或只在用户明确选择可恢复替换时执行。
- 不发布、不上传、不使用付费服务、不安装或升级依赖、不启动预览服务，除非用户对具体操作另行授权。

## 启动与恢复

1. 搜索当前项目的 `video-project.json`。
2. 找到后读取 `schema_version`、`production.mode` 和各阶段状态，从第一个未完成门禁继续。
3. 对 schema v1 项目保持兼容读取，不静默迁移。需要采用新路线时，先说明迁移字段及影响。
4. 没有状态文件时询问项目目录；用户批准创建后运行：

```bash
python <skill-dir>/scripts/init_project.py <project-dir> \
  --title "<项目名称>" \
  --mode <undecided|static_hyperframes|external_clips|hybrid>
```

5. 每次关键决定通过后更新 `video-project.json`。只记录最终有效选择，并严格区分生成、批准、锁定、自动验证和人工接受。

状态结构和兼容规则见 [references/project-state.md](references/project-state.md)。

## 制作模式

在分镜视觉方向清楚后确认 `production.mode`：

- `static_hyperframes`：用静态图、确定性摄影机运动、转场和字幕制作。适合文学、纪录、知识、编辑型视频，以及不需要真实人物动作的内容。结果最可控、可重复，不伪造口型或肢体动作。
- `external_clips`：把批准分镜交给用户选择的外部图生视频平台。适合人物、产品或环境必须发生真实动作的镜头；逐幕验收生成片段。
- `hybrid`：逐幕选择 `static_image` 或 `external_clip`。只把确有动作价值的镜头交给外部生成，其余使用确定性运镜。

不要根据“VOX”“纪录片”等风格词自动决定模式。说明动作需求、成本、稳定性和用户工作量后等待确认。完整路由见 [references/workflow.md](references/workflow.md)。

## 共同制作链

### 1. 需求与旁白

- 确认主题、目标、观众、平台、画幅、时长和语气。
- 已有音频时先检查、转写或核对文字，再按真实停顿拆分语义段落。
- 没有音频时先批准旁白初稿，再做视觉；全部分镜一致后锁定旁白并收最终音频。
- 音频到达后检查解码、时长、声道、采样率、静音、明显削波和文字一致性。

### 2. 风格、锚点与分镜

- 无参考时推荐 2～3 个真正不同的方向；有参考时先标注其用途并提取可执行约束。
- 固定人物、产品或品牌主体时先批准身份锚点。
- 以一个代表性镜头验证构图、风格、身份和后续运动空间；通过后再批量生成。
- 以语义变化决定图片数量。一个镜头只承担一个主要信息；长句出现新动作、视角或地点时拆镜头，而不是按句号机械配一张图。

读取 [references/image-and-style.md](references/image-and-style.md)。

### 3. 锁定时间线

- 用最终音频的真实词级时间或停顿锁定场景起止。
- 场景时长总和必须与音频一致；不得用全局比例拉伸词级时间戳修补累计漂移。
- 图片密度只作为起点：普通叙事可先按每个视觉节拍约 6～9 秒估算，安静长镜头可更长，转折和信息密集段落应更短。最终以内容和预览为准。

### 4. 字幕

- 从锁定旁白和词级时间生成字幕，不把识别文本直接当最终文案。
- 字幕内容必须可重建锁定旁白的有效字符，时间不得重叠或越过媒体时长。
- 标点、单行/多行、每条长度、专有词和书名是否保持由 `captions.policy` 决定，不把某个案例的规则设为默认。
- 读取 [references/captions.md](references/captions.md)；有受支持的词级时间文件时可运行 `scripts/align_captions.mjs`。

## 模式执行

### 静态 HyperFrames 或混合模式

- 开始编写或生成 HyperFrames 项目前先使用当前会话的 `hyperframes` Skill，并遵循其 core、animation、media 和 CLI 规则。
- 每幕使用静态图时，只做确定性推拉、平移、景别切换和转场；不通过局部扭曲伪造人物动作。
- 每幕使用外部片段时保持视频静音，旁白放在独立音轨；不要让平台自动音频混入成片。
- 运行 `scripts/build_hyperframes_project.mjs <video-project.json>` 生成无运行时网络素材依赖的 WAAPI 合成项目。输出目录已存在时默认拒绝覆盖。
- 生成后运行项目固定版本的 `npm run check`，抽取每幕可见中点并目视检查；获得最终预览批准后才渲染。

读取 [references/static-hyperframes.md](references/static-hyperframes.md)。

### 外部片段模式

- 用户确认平台和保存位置后，每次只交付一幕的图片、目标时长、中立提示词、平台适配、文件名和路径。
- 用户保存片段后立即检查文件、运动、身份、结构、黑帧和音轨；合格后才进入下一幕。
- 全部片段通过后可运行 `scripts/assemble_video.py` 制作基础成片。

读取 [references/video-prompts.md](references/video-prompts.md)。

## 验证与交付

- 用 `scripts/validate_project.py` 检查项目状态和指定阶段的前置条件。
- 用 `scripts/validate_media.py` 检查音频、外部片段和成片的规格与完整解码。
- HyperFrames 项目必须通过 `npm run check`；含多个镜头时必须检查按场景中点生成的快照。
- 最终成片必须检查视频流、音频流、分辨率、帧率、时长、完整解码、字幕安全区、漏幕、黑帧和明显拼接断裂。
- 自动检查通过不等于人工接受。最终交付前等待用户确认实际预览。

读取 [references/quality-gates.md](references/quality-gates.md)。

## 工具与资源

- `scripts/init_project.py`：创建 schema v2 项目目录和状态文件，不覆盖现有项目。
- `scripts/align_captions.mjs`：把锁定旁白对齐到受支持的词级时间，生成 JSON 和 SRT。
- `scripts/build_hyperframes_project.mjs`：从静态图、外部片段或混合场景生成确定性 HyperFrames 项目。
- `scripts/validate_project.py`：检查状态结构、阶段门禁、路径和时间线。
- `scripts/validate_media.py`：检查媒体流、规格、完整解码和可选帧变化。
- `scripts/assemble_video.py`：仅用于已通过门禁的外部片段基础拼接。
- `scripts/self_test.py`：在临时目录运行无网络的脚本自检。
- `assets/project-template.json`：通用 schema v2 状态模板。

## 完成声明

分别报告：旁白是否锁定、音频是否验证、图片是否批准、外部片段是否自动验证和人工接受、字幕是否校时、合成项目是否检查通过、成片是否渲染、成片是否自动验证、用户是否最终接受。缺少任一证据时不得提升状态。
