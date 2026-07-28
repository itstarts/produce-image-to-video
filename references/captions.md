# 字幕策略与对齐

## 输入

字幕以锁定旁白为文案源，以真实音频的词级或字级时间为时间源。不要直接采用自动识别文本作为最终字幕。

`scripts/align_captions.mjs` 支持常见结构：

- `transcription[].tokens[].offsets.from/to`，单位毫秒。
- `segments[].words[].start/end`，单位秒。
- 顶层 `words[]`。
- `voices[].words[]`。

词对象的文本字段可为 `text`、`word` 或 `token`；秒数字段可为 `start/end` 或 `start_s/end_s`。

## 项目配置

在 `video-project.json` 中填写：

```json
{
  "captions": {
    "enabled": true,
    "word_timing_path": "work/transcript/words.json",
    "output_json_path": "work/captions/captions.json",
    "output_srt_path": "work/captions/captions.srt",
    "status": "draft",
    "policy": {
      "single_line": true,
      "max_glyphs_per_cue": 16,
      "min_glyphs_per_cue": 4,
      "punctuation": "preserve",
      "protected_terms": ["专有名词"],
      "padding_before_seconds": 0.08,
      "padding_after_seconds": 0.16
    }
  }
}
```

`max_glyphs_per_cue` 为 `null` 时，脚本按画幅推导：竖屏 16，横屏 24。该值只是起点，最终由字幕字体、平台安全区和预览决定。

## 标点策略

- `preserve`：保留锁定旁白中的句尾标点；通用项目默认使用。
- `strip-pauses-keep-questions`：去除条目末尾的逗号、句号、顿号、分号、冒号和感叹号，保留问号。只在用户明确选择这种视觉风格时使用。

无论选择哪种策略，`《……》` 作为不可拆单元。其他专有词通过 `protected_terms` 配置，不写进通用脚本。

## 对齐原则

1. 规范化识别字符和锁定旁白字符，忽略空白及标点。
2. 用编辑距离建立识别字符到原文字符的单调映射。
3. 以锁定旁白的句界和长度策略拆分字幕。
4. 用映射后的真实词级时间生成每条起止时间。
5. 只做小幅首尾 padding 和相邻条目去重叠处理。
6. 不对词级时间应用全局时长比例。总时长缩放会让长音频后段出现累计超前或滞后。
7. 验证输出有效字符完整重建锁定旁白。

运行：

```bash
node <skill-dir>/scripts/align_captions.mjs <project>/video-project.json
```

脚本生成文件但不把 `captions.status` 自动提升为 `locked` 或 `auto_validated`。需要检查开头、中段、后段和最后一句，再由代理更新状态。

## 视觉规则

- 字幕样式属于项目选择，不绑定题材或案例。
- `clean-bottom` 可使用无背景、浅色字、深色描边和底部安全区；遇到复杂画面时可改用用户批准的背景或阴影。
- `font_file` 为空时使用系统字体，跨机器像素结果可能不同；需要稳定复现时使用项目内有授权的字体文件。
- 单行字幕使用 `white-space: nowrap`；如果内容无法在安全宽度内显示，先缩短条目，不通过过小字号强行容纳。
