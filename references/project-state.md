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
│   ├── normalized/
│   └── review/
└── outputs/
```

允许用户自定义目录，但状态文件必须记录实际路径。相对路径以项目目录为基准。

## 必要状态

- `intake`：目标、观众、发布平台、画幅、时长和语气
- `decisions`：只记录用户最终确认的关键选择
- `narration`：文案状态、锁定文本、音频路径和真实时长
- `style_profile`：当前批准的风格约束和参考图
- `video_generation`：用户选择的平台、手动操作方式、输出目录和命名规则
- `scenes`：每幕旁白、图片、目标时长、片段路径和验收状态
- `delivery`：成片路径、自动验证状态和人工确认状态

## 状态值

使用明确状态，不用模糊的 `done`：

```text
draft
awaiting_user
approved
locked
file_received
auto_validated
user_accepted
rejected
```

图片已生成、图片已确认、片段已保存、片段自动通过、片段人工接受、成片已合成和成片最终确认必须分别记录。

## 路径规则

- 推荐外部片段目录 `inputs/generated-clips/`。
- 用户提供自定义目录或具体文件时记录原路径；需要合成时可以读取该路径或经用户允许复制到项目内。
- 不覆盖用户已有文件。新版本使用明确版本后缀。
- 最终成片默认写入 `outputs/`，除非用户指定其他位置。
