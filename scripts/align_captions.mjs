#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ignored = /[\s，。！？：；、,.?!:;《》“”‘’（）()—…·]/u;
const sentenceEnd = /[。！？.!?]/u;
const pausePunctuation = /[，。；：、！,.!;:]+$/u;

function parseArgs(argv) {
  const args = { projectFile: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("-") && !args.projectFile) {
      args.projectFile = value;
    } else {
      throw new Error(`未知参数：${value}`);
    }
  }
  if (!args.projectFile) {
    throw new Error("用法：align_captions.mjs <video-project.json>");
  }
  return args;
}

function resolvePath(projectRoot, value) {
  if (!value || typeof value !== "string") return null;
  const expanded = value.startsWith("~/")
    ? path.join(process.env.HOME || "", value.slice(2))
    : value;
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(projectRoot, expanded);
}

function contentChars(value) {
  return [...value].filter((char) => !ignored.test(char));
}

function getTokenText(token) {
  for (const key of ["text", "word", "token"]) {
    if (typeof token?.[key] === "string") return token[key];
  }
  return "";
}

function getTokenTiming(token) {
  if (token?.offsets && Number.isFinite(token.offsets.from) && Number.isFinite(token.offsets.to)) {
    return [token.offsets.from / 1000, token.offsets.to / 1000];
  }
  for (const [startKey, endKey] of [
    ["start", "end"],
    ["start_s", "end_s"],
    ["start_time", "end_time"],
  ]) {
    if (Number.isFinite(token?.[startKey]) && Number.isFinite(token?.[endKey])) {
      return [Number(token[startKey]), Number(token[endKey])];
    }
  }
  return null;
}

function extractTokens(data) {
  const candidates = [];
  if (Array.isArray(data?.transcription)) {
    for (const entry of data.transcription) {
      if (Array.isArray(entry?.tokens)) candidates.push(...entry.tokens);
      else candidates.push(entry);
    }
  }
  if (Array.isArray(data?.segments)) {
    for (const segment of data.segments) {
      if (Array.isArray(segment?.words)) candidates.push(...segment.words);
      else if (Array.isArray(segment?.tokens)) candidates.push(...segment.tokens);
    }
  }
  if (Array.isArray(data?.words)) candidates.push(...data.words);
  if (Array.isArray(data?.voices)) {
    for (const voice of data.voices) {
      if (Array.isArray(voice?.words)) candidates.push(...voice.words);
    }
  }

  const tokens = [];
  for (const token of candidates) {
    const text = getTokenText(token).trim();
    const timing = getTokenTiming(token);
    if (!text || text.startsWith("[_") || !timing) continue;
    const [start, end] = timing;
    if (start < 0 || end <= start) continue;
    tokens.push({ text, start, end });
  }
  if (tokens.length === 0) {
    throw new Error("词级时间文件中没有受支持的有效 token/word");
  }
  tokens.sort((a, b) => a.start - b.start || a.end - b.end);
  return tokens;
}

function buildCharacterTimings(tokens) {
  const timings = [];
  for (const token of tokens) {
    const chars = contentChars(token.text);
    if (chars.length === 0) continue;
    const duration = Math.max(0.04, token.end - token.start);
    chars.forEach((char, index) => {
      timings.push({
        char,
        start: token.start + (duration * index) / chars.length,
        end: token.start + (duration * (index + 1)) / chars.length,
      });
    });
  }
  if (timings.length === 0) throw new Error("词级时间中没有可对齐的有效字符");
  return timings;
}

function alignCharacters(recognized, original) {
  const n = recognized.length;
  const m = original.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i += 1) dp[i][0] = i;
  for (let j = 0; j <= m; j += 1) dp[0][j] = j;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const substitution = dp[i - 1][j - 1] + (recognized[i - 1] === original[j - 1] ? 0 : 1);
      const deletion = dp[i - 1][j] + 1;
      const insertion = dp[i][j - 1] + 1;
      dp[i][j] = Math.min(substitution, deletion, insertion);
    }
  }

  const originalToRecognized = new Array(m);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      dp[i][j] === dp[i - 1][j - 1] + (recognized[i - 1] === original[j - 1] ? 0 : 1)
    ) {
      originalToRecognized[j - 1] = i - 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      i -= 1;
    } else {
      originalToRecognized[j - 1] = Math.max(0, i - 1);
      j -= 1;
    }
  }

  for (let index = 1; index < originalToRecognized.length; index += 1) {
    if (originalToRecognized[index] === undefined) {
      originalToRecognized[index] = originalToRecognized[index - 1];
    }
  }
  for (let index = originalToRecognized.length - 2; index >= 0; index -= 1) {
    if (originalToRecognized[index] === undefined) {
      originalToRecognized[index] = originalToRecognized[index + 1];
    }
  }
  if (originalToRecognized[0] === undefined) {
    throw new Error("无法建立旁白与识别字符的映射");
  }
  return { distance: dp[n][m], originalToRecognized };
}

function atomicUnits(value, protectedTerms) {
  const chars = [...value];
  const terms = [...protectedTerms].filter(Boolean).sort((a, b) => [...b].length - [...a].length);
  const units = [];
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] === "《") {
      const title = [chars[index]];
      while (index + 1 < chars.length) {
        index += 1;
        title.push(chars[index]);
        if (chars[index] === "》") break;
      }
      units.push(title.join(""));
      continue;
    }
    const term = terms.find((candidate) => {
      const termChars = [...candidate];
      return termChars.every((char, offset) => chars[index + offset] === char);
    });
    if (term) {
      units.push(term);
      index += [...term].length - 1;
      continue;
    }
    units.push(chars[index]);
  }
  return units;
}

function splitSentences(value) {
  const sentences = [];
  let current = "";
  for (const char of [...value]) {
    current += char;
    if (sentenceEnd.test(char)) {
      sentences.push(current);
      current = "";
    }
  }
  if (current) sentences.push(current);
  return sentences;
}

function glyphCount(value) {
  return [...value].length;
}

function splitLongSegment(value, maxGlyphs, minGlyphs, protectedTerms) {
  const units = atomicUnits(value, protectedTerms);
  const parts = [];
  let start = 0;
  while (start < units.length) {
    const remaining = units.slice(start).join("");
    if (glyphCount(remaining) <= maxGlyphs) {
      parts.push(remaining);
      break;
    }

    let maxBoundary = start;
    let width = 0;
    while (maxBoundary < units.length && width + glyphCount(units[maxBoundary]) <= maxGlyphs) {
      width += glyphCount(units[maxBoundary]);
      maxBoundary += 1;
    }
    if (maxBoundary === start) {
      throw new Error(`不可拆分单元超过字幕上限 ${maxGlyphs}：${units[start]}`);
    }

    const candidates = [];
    for (let boundary = start + 1; boundary <= maxBoundary; boundary += 1) {
      const left = units.slice(start, boundary).join("");
      const right = units.slice(boundary).join("");
      const leftWidth = glyphCount(left);
      const rightWidth = glyphCount(right);
      if (leftWidth < minGlyphs || rightWidth < minGlyphs) continue;
      const punctuationScore = /[，,；;：:]$/u.test(left) ? 100 : 0;
      const balanceScore = Math.min(leftWidth, Math.min(maxGlyphs, rightWidth));
      candidates.push({ boundary, score: punctuationScore + balanceScore, leftWidth });
    }
    let boundary = maxBoundary;
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score || b.leftWidth - a.leftWidth);
      boundary = candidates[0].boundary;
    } else {
      while (
        boundary > start + 1 &&
        glyphCount(units.slice(boundary).join("")) < minGlyphs
      ) {
        boundary -= 1;
      }
    }
    parts.push(units.slice(start, boundary).join(""));
    start = boundary;
  }
  return parts;
}

function applyPunctuationPolicy(value, policy) {
  if (policy === "preserve") return value;
  if (policy === "strip-pauses-keep-questions") return value.replace(pausePunctuation, "");
  throw new Error(`不支持 captions.policy.punctuation：${policy}`);
}

function srtTime(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectFile = path.resolve(args.projectFile);
  const projectRoot = path.dirname(projectFile);
  const state = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  if (state.schema_version !== 2) throw new Error("align_captions.mjs 只写入 schema v2 项目的字幕输出");

  const captions = state.captions;
  const narration = state.narration;
  if (!captions?.enabled) throw new Error("captions.enabled 不是 true");
  if (narration?.script_status !== "locked") throw new Error("旁白尚未 locked");
  const audioDuration = Number(narration?.audio_duration_seconds);
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) throw new Error("缺少有效音频时长");

  const scriptPath = resolvePath(projectRoot, narration.script_path);
  const timingPath = resolvePath(projectRoot, captions.word_timing_path);
  const jsonOut = resolvePath(projectRoot, captions.output_json_path);
  const srtOut = resolvePath(projectRoot, captions.output_srt_path);
  for (const [label, target] of [
    ["旁白", scriptPath],
    ["词级时间", timingPath],
  ]) {
    if (!target || !fs.existsSync(target)) throw new Error(`${label}文件不存在：${target}`);
  }
  if (!jsonOut || !srtOut) throw new Error("缺少字幕输出路径");

  const originalRaw = fs.readFileSync(scriptPath, "utf8").replace(/\s+/gu, "");
  const original = contentChars(originalRaw);
  if (original.length === 0) throw new Error("锁定旁白没有有效字符");
  const tokens = extractTokens(JSON.parse(fs.readFileSync(timingPath, "utf8")));
  const recognizedTimings = buildCharacterTimings(tokens);
  const recognized = recognizedTimings.map((entry) => entry.char);
  const alignment = alignCharacters(recognized, original);

  const policy = captions.policy || {};
  const maxGlyphs = Number.isInteger(policy.max_glyphs_per_cue)
    ? policy.max_glyphs_per_cue
    : Number(state.project?.height) > Number(state.project?.width)
      ? 16
      : 24;
  const minGlyphs = Number.isInteger(policy.min_glyphs_per_cue)
    ? policy.min_glyphs_per_cue
    : 4;
  if (maxGlyphs < 2 || minGlyphs < 1 || minGlyphs >= maxGlyphs) {
    throw new Error("字幕最大/最小字符配置无效");
  }
  const protectedTerms = Array.isArray(policy.protected_terms) ? policy.protected_terms : [];
  const punctuation = policy.punctuation || "preserve";
  const paddingBefore = Number(policy.padding_before_seconds ?? 0.08);
  const paddingAfter = Number(policy.padding_after_seconds ?? 0.16);
  const maxErrorRatio = Number(policy.max_alignment_error_ratio ?? 0.35);
  if ([paddingBefore, paddingAfter, maxErrorRatio].some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("字幕 padding 或对齐阈值无效");
  }
  const alignmentRatio = alignment.distance / Math.max(original.length, recognized.length);
  if (alignmentRatio > maxErrorRatio) {
    throw new Error(
      `音频识别与锁定旁白差异过大：${alignmentRatio.toFixed(3)} > ${maxErrorRatio.toFixed(3)}`,
    );
  }

  const captionTexts = splitSentences(originalRaw).flatMap((sentence) =>
    splitLongSegment(sentence, maxGlyphs, minGlyphs, protectedTerms),
  );
  let originalBoundary = 0;
  const cues = captionTexts.map((sourceText) => {
    const length = contentChars(sourceText).length;
    if (length === 0) throw new Error(`字幕片段没有有效字符：${sourceText}`);
    const sourceStart = originalBoundary;
    const sourceEnd = originalBoundary + length;
    originalBoundary = sourceEnd;
    const recognizedStart = alignment.originalToRecognized[sourceStart];
    const recognizedEnd = alignment.originalToRecognized[sourceEnd - 1];
    return {
      start: Math.max(0, recognizedTimings[recognizedStart].start - paddingBefore),
      end: Math.min(audioDuration, recognizedTimings[recognizedEnd].end + paddingAfter),
      text: applyPunctuationPolicy(sourceText, punctuation),
    };
  });

  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].start < cues[index - 1].end) {
      const boundary = (cues[index].start + cues[index - 1].end) / 2;
      cues[index - 1].end = boundary;
      cues[index].start = boundary;
    }
  }
  cues.forEach((cue, index) => {
    cue.id = `caption-${String(index + 1).padStart(3, "0")}`;
    cue.start = Number(cue.start.toFixed(3));
    cue.end = Number(cue.end.toFixed(3));
    cue.duration = Number((cue.end - cue.start).toFixed(3));
    if (!cue.text || cue.duration <= 0) throw new Error(`字幕 ${cue.id} 无效`);
    if (glyphCount(cue.text) > maxGlyphs) throw new Error(`字幕 ${cue.id} 超过字符上限`);
    if (index > 0 && cue.start < cues[index - 1].end) throw new Error(`字幕 ${cue.id} 重叠`);
  });

  const rebuilt = contentChars(cues.map((cue) => cue.text).join("")).join("");
  const expected = original.join("");
  if (rebuilt !== expected) {
    throw new Error(`字幕不能重建锁定旁白：${rebuilt.length}/${expected.length}`);
  }

  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.mkdirSync(path.dirname(srtOut), { recursive: true });
  fs.writeFileSync(jsonOut, `${JSON.stringify(cues, null, 2)}\n`);
  const srt = cues
    .map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}`)
    .join("\n\n");
  fs.writeFileSync(srtOut, `${srt}\n`);

  console.log(
    JSON.stringify({
      cueCount: cues.length,
      alignmentDistance: alignment.distance,
      alignmentRatio: Number(alignmentRatio.toFixed(4)),
      recognizedCharacters: recognized.length,
      scriptCharacters: original.length,
      timingMode: "word-offsets-no-global-scale",
      maxCaptionCharacters: Math.max(...cues.map((cue) => glyphCount(cue.text))),
      maxCaptionCharactersAllowed: maxGlyphs,
      outputJson: path.relative(projectRoot, jsonOut),
      outputSrt: path.relative(projectRoot, srtOut),
    }),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
