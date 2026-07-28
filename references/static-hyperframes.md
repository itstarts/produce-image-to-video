# 静态图片与混合 HyperFrames 路线

## 前置条件

生成前必须满足：

- `production.mode` 为 `static_hyperframes` 或 `hybrid`。
- `production.hyperframes.hyperframes_version` 是明确的 `X.Y.Z` 版本。
- 旁白和音频已锁定，场景时间线覆盖完整音频。
- 静态场景至少有一张 `approved` 图片。
- 混合场景中的外部片段已 `auto_validated` 或 `user_accepted`。
- 启用字幕时，字幕 JSON 已生成并完成内容检查。

开始生成前使用当前会话的 `hyperframes` Skill。不要把本参考文件当作 HyperFrames 框架规范的替代品。

## 场景与图片

- `production_strategy: static_image`：使用 `images[]`。
- `production_strategy: external_clip`：使用 `clip_path`，视频在合成中始终静音。
- 一幕只有一张图时，使用整幕的确定性摄影机运动。
- 一幕有多张图且没有显式时间时，在该幕内等分时长并使用短叠化。
- 需要精确节奏时，为每张图填写相对该幕的 `start_offset_seconds` 和 `duration_seconds`；所有窗口必须落在场景内。
- 静态场景可提前一个转场时长进入以形成真实叠化。外部片段默认保持锁定的语义时长，入口使用短淡入，避免为了转场擅自延长片段或提前播放动作。

## 通用运动配置

生成器提供以下确定性预设：

- `auto`：按场景序号循环使用克制的推进、拉远和左右平移。
- `push_in`：缓慢推进。
- `pull_out`：缓慢拉远。
- `pan_left`：轻微向左平移并推进。
- `pan_right`：轻微向右平移并推进。
- `static_hold`：不做摄影机位移，只允许镜头转场；仅在内容明确需要静止时使用。

幅度由 `scale_min`、`scale_max` 和 `pan_ratio` 控制。默认只是安全起点；主体靠近画面边缘、文字或产品结构敏感时应逐幕调整 `object_position` 或降低运动幅度。

不要使用局部形变、液化、人脸重绘或遮罩位移伪造人物动作。需要真实动作时改用 `external_clip`。

## 生成器

```bash
node <skill-dir>/scripts/build_hyperframes_project.mjs <project>/video-project.json
```

可选参数：

- `--output-dir <path>`：覆盖状态中的生成目录。
- `--replace-generated`：仅当现有目录包含生成器标记时，把旧目录移动为编号备份后重新生成；不删除旧目录。

生成器：

- 使用单文件 HyperFrames 合成，避免跨文件挂载错误。
- 使用浏览器原生 WAAPI，合成 HTML 不依赖运行时网络加载动画库。
- 把批准图片、外部片段、旁白和可选字体复制到生成项目的 `assets/`。
- 为视频片段设置 `muted`，只使用独立旁白 `<audio>`。
- 生成固定版本 `package.json`、`hyperframes.json`、`index.html`、运动断言和构建清单。
- 默认拒绝覆盖已有非空目录。

## 验证顺序

1. 在项目生成前运行：

```bash
python <skill-dir>/scripts/validate_project.py <project>/video-project.json --stage compose --check-files
```

2. 进入生成的 HyperFrames 目录，使用固定版本运行：

```bash
npm run check
```

3. 按每幕可见中点运行快照并检查实际图片或视频是否出现、裁切是否正确、字幕是否在安全区。
4. 检查通过后启动最终 Studio 预览；预览批准后才执行高质量渲染。
5. 用 `validate_media.py` 完整解码最终成片，并更新交付状态。

生成项目的 `npm run check` 可能在本机未缓存指定版本时需要联网下载。安装、下载、升级和启动服务仍按用户授权规则处理。
