#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const MARKER = ".generated-by-produce-image-to-video";
const READY_IMAGE_STATUSES = new Set(["approved", "locked", "auto_validated", "user_accepted"]);
const READY_CLIP_STATUSES = new Set(["auto_validated", "user_accepted"]);

function parseArgs(argv) {
  const args = { projectFile: "", outputDir: "", replaceGenerated: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("-") && !args.projectFile) args.projectFile = value;
    else if (value === "--output-dir") args.outputDir = argv[++index] || "";
    else if (value === "--replace-generated") args.replaceGenerated = true;
    else throw new Error(`未知参数：${value}`);
  }
  if (!args.projectFile) {
    throw new Error(
      "用法：build_hyperframes_project.mjs <video-project.json> [--output-dir <path>] [--replace-generated]",
    );
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

function escHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escJs(value) {
  return JSON.stringify(String(value));
}

function fmt(value) {
  return Number(Number(value).toFixed(6));
}

function slugify(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "image-video-project";
}

function ensureFile(file, label) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`${label}不存在：${file}`);
  }
}

function write(root, relative, content) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${content.trim()}\n`);
}

function copyAsset(tempRoot, source, category, fileName) {
  ensureFile(source, "素材文件");
  const relative = path.posix.join("assets", category, fileName);
  const destination = path.join(tempRoot, ...relative.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return relative;
}

function sceneImages(scene) {
  if (Array.isArray(scene.images)) return scene.images;
  if (scene.image_path) {
    return [{ path: scene.image_path, status: scene.image_status, role: "primary" }];
  }
  return [];
}

function motionPlan(preset, index, profile, width, height) {
  const scaleMin = Number(profile.scale_min ?? 1.02);
  const scaleMax = Number(profile.scale_max ?? 1.08);
  const pan = Math.round(Math.min(width, height) * Number(profile.pan_ratio ?? 0.025));
  const selected = preset === "auto" || !preset
    ? ["push_in", "pan_right", "pull_out", "pan_left"][index % 4]
    : preset;
  const plans = {
    push_in: [`translate3d(0px, ${Math.round(pan * 0.25)}px, 0) scale(${scaleMin})`, `translate3d(0px, ${-Math.round(pan * 0.5)}px, 0) scale(${scaleMax})`],
    pull_out: [`translate3d(${Math.round(pan * 0.25)}px, 0px, 0) scale(${scaleMax})`, `translate3d(0px, 0px, 0) scale(${scaleMin})`],
    pan_left: [`translate3d(${pan}px, 0px, 0) scale(${scaleMin})`, `translate3d(${-pan}px, ${-Math.round(pan * 0.2)}px, 0) scale(${scaleMax})`],
    pan_right: [`translate3d(${-pan}px, 0px, 0) scale(${scaleMin})`, `translate3d(${pan}px, ${-Math.round(pan * 0.2)}px, 0) scale(${scaleMax})`],
    static_hold: ["translate3d(0px, 0px, 0) scale(1.02)", "translate3d(0px, 0px, 0) scale(1.02)"],
  };
  if (!plans[selected]) throw new Error(`不支持 motion_preset：${selected}`);
  return { selected, from: plans[selected][0], to: plans[selected][1] };
}

function computeShotWindows(scene, images, hostStart, hostDuration, transitionDuration) {
  const sceneStart = Number(scene.timeline_start_seconds);
  const sceneEnd = Number(scene.timeline_end_seconds);
  const hasExplicit = images.some(
    (image) => image.start_offset_seconds !== undefined || image.duration_seconds !== undefined,
  );
  if (!hasExplicit) {
    const equal = hostDuration / images.length;
    return images.map((image, index) => ({
      image,
      start: hostStart + equal * index,
      end: index === images.length - 1 ? sceneEnd : hostStart + equal * (index + 1),
    }));
  }
  if (!images.every(
    (image) => Number.isFinite(Number(image.start_offset_seconds)) && Number.isFinite(Number(image.duration_seconds)),
  )) {
    throw new Error(`scene-${scene.scene_id} 的图片必须全部提供 start_offset_seconds 和 duration_seconds`);
  }
  const windows = images.map((image, index) => {
    const semanticStart = sceneStart + Number(image.start_offset_seconds);
    const semanticEnd = semanticStart + Number(image.duration_seconds);
    if (semanticStart < sceneStart - 0.001 || semanticEnd > sceneEnd + 0.001 || semanticEnd <= semanticStart) {
      throw new Error(`scene-${scene.scene_id} 图片 ${index + 1} 的显式时间越界`);
    }
    return {
      image,
      start: index === 0 ? Math.max(0, semanticStart - transitionDuration) : semanticStart,
      end: index === images.length - 1 ? sceneEnd : semanticEnd,
    };
  });
  for (let index = 1; index < windows.length; index += 1) {
    const delta = windows[index].start - windows[index - 1].end;
    if (Math.abs(delta) > 0.05) {
      throw new Error(`scene-${scene.scene_id} 的显式图片时间存在 ${delta.toFixed(3)}s 空隙或重叠`);
    }
  }
  return windows;
}

function nextBackupPath(destination) {
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${destination}.backup-${String(index).padStart(2, "0")}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`无法为现有目录分配备份名称：${destination}`);
}

function finalize(tempRoot, outputDir, replaceGenerated) {
  let backup = null;
  if (fs.existsSync(outputDir)) {
    const entries = fs.readdirSync(outputDir).filter((name) => name !== ".DS_Store");
    if (entries.length === 0) {
      fs.rmdirSync(outputDir);
    } else {
      if (!replaceGenerated) throw new Error(`输出目录非空，拒绝覆盖：${outputDir}`);
      if (!fs.existsSync(path.join(outputDir, MARKER))) {
        throw new Error(`输出目录没有生成器标记，拒绝替换：${outputDir}`);
      }
      backup = nextBackupPath(outputDir);
      fs.renameSync(outputDir, backup);
    }
  }
  try {
    fs.renameSync(tempRoot, outputDir);
  } catch (error) {
    if (backup && !fs.existsSync(outputDir)) fs.renameSync(backup, outputDir);
    throw error;
  }
  return backup;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectFile = path.resolve(args.projectFile);
  const projectRoot = path.dirname(projectFile);
  const state = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  if (state.schema_version !== 2) throw new Error("HyperFrames 生成器只接受 schema v2 项目");
  const mode = state.production?.mode;
  if (!["static_hyperframes", "hybrid"].includes(mode)) {
    throw new Error(`production.mode 必须是 static_hyperframes 或 hybrid，当前为 ${mode}`);
  }
  const project = state.project || {};
  const width = Number(project.width);
  const height = Number(project.height);
  const fps = Number(project.fps);
  const duration = Number(state.narration?.audio_duration_seconds);
  if (![width, height, fps, duration].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("项目宽高、帧率或音频时长无效");
  }
  if (state.narration?.script_status !== "locked" || state.narration?.timing_status !== "locked") {
    throw new Error("生成前旁白和场景时序必须 locked");
  }
  const audioSource = resolvePath(projectRoot, state.narration.audio_path);
  ensureFile(audioSource, "旁白音频");

  const hf = state.production?.hyperframes || {};
  const version = String(hf.hyperframes_version || "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("hyperframes_version 必须是精确 X.Y.Z");
  const transition = hf.transition || {};
  if ((transition.type || "crossfade") !== "crossfade") {
    throw new Error(`生成器暂不支持转场：${transition.type}`);
  }
  const transitionDuration = Number(transition.duration_seconds ?? 0.55);
  if (!Number.isFinite(transitionDuration) || transitionDuration < 0) {
    throw new Error("转场时长无效");
  }
  const profile = hf.motion_profile || {};
  const internalTransition = Number(profile.internal_transition_duration_seconds ?? 0.45);
  const outputDir = args.outputDir
    ? resolvePath(projectRoot, args.outputDir)
    : resolvePath(projectRoot, hf.project_directory);
  if (!outputDir) throw new Error("缺少 HyperFrames 输出目录");
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  const tempRoot = path.join(path.dirname(outputDir), `.${path.basename(outputDir)}.building-${process.pid}`);
  if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: false });

  try {
    const audioExt = path.extname(audioSource) || ".wav";
    const audioAsset = copyAsset(tempRoot, audioSource, "audio", `narration${audioExt.toLowerCase()}`);
    const captionsConfig = state.captions || {};
    let captions = [];
    if (captionsConfig.enabled) {
      const captionPath = resolvePath(projectRoot, captionsConfig.output_json_path);
      ensureFile(captionPath, "字幕 JSON");
      captions = JSON.parse(fs.readFileSync(captionPath, "utf8"));
      if (!Array.isArray(captions) || captions.length === 0) throw new Error("字幕 JSON 必须是非空数组");
    }

    const captionStyle = captionsConfig.style || {};
    let fontAsset = "";
    if (captionStyle.font_file) {
      const fontSource = resolvePath(projectRoot, captionStyle.font_file);
      const fontExt = path.extname(fontSource) || ".woff2";
      fontAsset = copyAsset(tempRoot, fontSource, "fonts", `captions${fontExt.toLowerCase()}`);
    }

    const scenes = state.scenes;
    if (!Array.isArray(scenes) || scenes.length === 0) throw new Error("项目没有场景");
    const sceneMarkup = [];
    const animationLines = [];
    const storyboardLines = [];
    const assetManifest = [];

    scenes.forEach((scene, sceneIndex) => {
      const sceneId = slugify(`scene-${scene.scene_id || sceneIndex + 1}`);
      const start = Number(scene.timeline_start_seconds);
      const end = Number(scene.timeline_end_seconds);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new Error(`scene-${scene.scene_id || sceneIndex + 1} 时间线无效`);
      }
      const strategy = mode === "static_hyperframes"
        ? "static_image"
        : scene.production_strategy;
      if (mode === "static_hyperframes" && scene.production_strategy && scene.production_strategy !== "static_image") {
        throw new Error(`scene-${scene.scene_id} 与 static_hyperframes 模式冲突`);
      }
      if (!["static_image", "external_clip"].includes(strategy)) {
        throw new Error(`scene-${scene.scene_id} 缺少有效 production_strategy`);
      }
      if (sceneIndex > 0 && transitionDuration >= end - start) {
        throw new Error(`scene-${scene.scene_id} 的转场时长必须小于场景时长`);
      }
      // Static plates can safely start early to create a true crossfade. External
      // clips keep their semantic duration unless the project explicitly supplies handles.
      const hostStart = sceneIndex === 0 || strategy === "external_clip"
        ? start
        : Math.max(0, start - transitionDuration);
      const hostDuration = end - hostStart;
      const track = sceneIndex % 2 === 0 ? 1 : 2;

      if (strategy === "static_image") {
        const images = sceneImages(scene);
        if (images.length === 0) throw new Error(`scene-${scene.scene_id} 没有图片`);
        images.forEach((image, imageIndex) => {
          if (!READY_IMAGE_STATUSES.has(image.status)) {
            throw new Error(`scene-${scene.scene_id} 图片 ${imageIndex + 1} 尚未批准`);
          }
        });
        const shotWindows = computeShotWindows(
          scene,
          images,
          hostStart,
          hostDuration,
          transitionDuration,
        );
        const shotMarkup = [];
        shotWindows.forEach((shot, imageIndex) => {
          const source = resolvePath(projectRoot, shot.image.path);
          ensureFile(source, `scene-${scene.scene_id} 图片 ${imageIndex + 1}`);
          const ext = (path.extname(source) || ".png").toLowerCase();
          const asset = copyAsset(
            tempRoot,
            source,
            "images",
            `${sceneId}-${String(imageIndex + 1).padStart(2, "0")}${ext}`,
          );
          assetManifest.push({ scene_id: scene.scene_id, type: "image", source: shot.image.path, asset });
          const shotId = `${sceneId}-shot-${String(imageIndex + 1).padStart(2, "0")}`;
          const cameraId = `${sceneId}-camera-${String(imageIndex + 1).padStart(2, "0")}`;
          const position = escHtml(shot.image.object_position || "50% 50%");
          shotMarkup.push(`        <div id="${shotId}" class="shot" data-layout-allow-overflow><div id="${cameraId}" class="camera"><img src="${asset}" alt="${escHtml(scene.visual_goal || scene.narration_text || sceneId)}" style="object-position:${position}" /></div></div>`);
          const plan = motionPlan(scene.motion_preset || profile.default_preset || "auto", sceneIndex + imageIndex, profile, width, height);
          const shotDuration = Math.max(0.05, shot.end - shot.start);
          const fadeDuration = Math.min(internalTransition, shotDuration * 0.4);
          if (shotWindows.length === 1) {
            animationLines.push(`      addAnimation("#${shotId}", [{ opacity: 0 }, { opacity: 1 }], { delay: ${fmt(shot.start * 1000)}, duration: ${fmt(Math.max(80, fadeDuration * 1000))}, easing: "ease-out", fill: "both" });`);
          } else {
            const fadeRatio = Math.min(0.45, fadeDuration / shotDuration);
            animationLines.push(`      addAnimation("#${shotId}", [{ opacity: 0, offset: 0 }, { opacity: 1, offset: ${fmt(fadeRatio)} }, { opacity: 1, offset: ${fmt(1 - fadeRatio)} }, { opacity: 0, offset: 1 }], { delay: ${fmt(shot.start * 1000)}, duration: ${fmt(shotDuration * 1000)}, easing: "linear", fill: "both" });`);
          }
          animationLines.push(`      addAnimation("#${cameraId}", [{ transform: ${escJs(plan.from)} }, { transform: ${escJs(plan.to)} }], { delay: ${fmt(shot.start * 1000)}, duration: ${fmt(shotDuration * 1000)}, easing: "linear", fill: "both" });`);
        });
        sceneMarkup.push(`      <section id="${sceneId}" class="clip scene" data-start="${fmt(hostStart)}" data-duration="${fmt(hostDuration)}" data-track-index="${track}" data-layout-allow-overflow style="z-index:${10 + sceneIndex}">\n${shotMarkup.join("\n")}\n      </section>`);
      } else {
        if (!READY_CLIP_STATUSES.has(scene.clip_status)) {
          throw new Error(`scene-${scene.scene_id} 外部片段尚未通过门禁`);
        }
        const source = resolvePath(projectRoot, scene.clip_path);
        ensureFile(source, `scene-${scene.scene_id} 外部片段`);
        const ext = (path.extname(source) || ".mp4").toLowerCase();
        const asset = copyAsset(tempRoot, source, "video", `${sceneId}${ext}`);
        assetManifest.push({ scene_id: scene.scene_id, type: "video", source: scene.clip_path, asset });
        const layerId = `${sceneId}-video-layer`;
        sceneMarkup.push(`      <div id="${layerId}" class="external-layer" style="z-index:${10 + sceneIndex}"><video id="${sceneId}-video" class="clip scene-video" src="${asset}" data-start="${fmt(hostStart)}" data-duration="${fmt(hostDuration)}" data-track-index="${track}" data-media-start="0" muted playsinline></video></div>`);
        animationLines.push(`      addAnimation("#${layerId}", [{ opacity: 0 }, { opacity: 1 }], { delay: ${fmt(hostStart * 1000)}, duration: ${fmt(Math.max(80, Math.min(transitionDuration, hostDuration * 0.4) * 1000))}, easing: "ease-in-out", fill: "both" });`);
      }
      storyboardLines.push(`## Frame ${scene.scene_id || sceneIndex + 1} — ${scene.visual_goal || scene.narration_text || "未命名场景"}\n\n- start: ${fmt(start)}s\n- end: ${fmt(end)}s\n- strategy: ${strategy}\n- motion: ${scene.motion_preset || profile.default_preset || "auto"}`);
    });

    const captionMarkup = [];
    captions.forEach((caption, index) => {
      const id = slugify(caption.id || `caption-${index + 1}`);
      const start = Number(caption.start);
      const end = Number(caption.end ?? start + Number(caption.duration));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > duration + 0.001) {
        throw new Error(`字幕 ${caption.id || index + 1} 时间无效`);
      }
      captionMarkup.push(`      <div id="${id}" class="clip caption" data-start="${fmt(start)}" data-duration="${fmt(end - start)}" data-track-index="20" data-layout-allow-overlap><span class="caption-text">${escHtml(caption.text)}</span></div>`);
      const fadeIn = Math.min(0.22, (end - start) * 0.25);
      const fadeOut = Math.min(0.16, (end - start) * 0.2);
      const holdEnd = Math.max(fadeIn, end - start - fadeOut);
      animationLines.push(`      addAnimation("#${id} .caption-text", [{ opacity: 0, transform: "translate3d(0, 12px, 0)", offset: 0 }, { opacity: 1, transform: "translate3d(0, 0, 0)", offset: ${fmt(fadeIn / (end - start))} }, { opacity: 1, transform: "translate3d(0, 0, 0)", offset: ${fmt(holdEnd / (end - start))} }, { opacity: 0, transform: "translate3d(0, -5px, 0)", offset: 1 }], { delay: ${fmt(start * 1000)}, duration: ${fmt((end - start) * 1000)}, easing: "linear", fill: "both" });`);
    });

    const minDimension = Math.min(width, height);
    const fontSize = captionStyle.font_size_px !== null &&
      captionStyle.font_size_px !== undefined &&
      Number.isFinite(Number(captionStyle.font_size_px)) &&
      Number(captionStyle.font_size_px) > 0
      ? Number(captionStyle.font_size_px)
      : Math.round(minDimension * 0.048);
    const bottom = Math.round(height * Number(captionStyle.safe_bottom_ratio ?? 0.083));
    const side = Math.round(width * Number(captionStyle.safe_side_ratio ?? 0.045));
    const singleLine = captionsConfig.policy?.single_line !== false;
    const captionBackground = captionStyle.background || "none";
    const fontFace = fontAsset
      ? `@font-face { font-family: "Project Caption Font"; src: url("${fontAsset}"); font-display: block; }`
      : "";
    const fontFamily = fontAsset
      ? `"Project Caption Font", ${captionStyle.font_family || "sans-serif"}`
      : captionStyle.font_family || "system-ui, sans-serif";
    const projectSlug = slugify(project.slug || project.title || path.basename(projectRoot));
    const backgroundColor = hf.background_color || "#111111";

    write(tempRoot, "package.json", JSON.stringify({
      name: projectSlug,
      private: true,
      type: "module",
      scripts: {
        dev: `npx --yes hyperframes@${version} preview`,
        check: `npx --yes hyperframes@${version} check`,
        render: `npx --yes hyperframes@${version} render`,
      },
    }, null, 2));
    write(tempRoot, "hyperframes.json", JSON.stringify({
      $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
      registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
      paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
      media: { autoProxy: true },
    }, null, 2));
    write(tempRoot, "meta.json", JSON.stringify({ id: projectSlug, name: project.title || projectSlug }, null, 2));
    write(tempRoot, MARKER, JSON.stringify({ generator: "produce-image-to-video", schema_version: 2 }, null, 2));
    write(tempRoot, "build-manifest.json", JSON.stringify({
      source_project: path.relative(projectRoot, projectFile) || path.basename(projectFile),
      production_mode: mode,
      duration_seconds: duration,
      scene_count: scenes.length,
      caption_count: captions.length,
      hyperframes_version: version,
      assets: assetManifest,
    }, null, 2));

    write(tempRoot, "index.html", `
<!doctype html>
<html lang="${escHtml(project.language || "zh-CN")}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      ${fontFace}
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${escHtml(backgroundColor)}; }
      #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; isolation: isolate; background: transparent; }
      .canvas-bg { position: absolute; inset: 0; background: ${escHtml(backgroundColor)}; z-index: 0; }
      .scene, .external-layer { position: absolute; inset: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
      .external-layer { opacity: 0; }
      .scene-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .shot { position: absolute; inset: 0; overflow: hidden; opacity: 0; }
      .camera { position: absolute; inset: -4%; transform-origin: 50% 50%; will-change: transform; }
      .camera img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .caption { position: absolute; left: ${side}px; right: ${side}px; bottom: ${bottom}px; z-index: 1000; display: flex; justify-content: center; align-items: flex-end; background: none; }
      .caption-text { display: block; max-width: ${width - side * 2}px; color: ${escHtml(captionStyle.text_color || "#fffdf7")}; background: ${escHtml(captionBackground)}; ${captionBackground === "none" ? "padding:0;border-radius:0;" : "padding:10px 18px;border-radius:12px;"} text-align: center; white-space: ${singleLine ? "nowrap" : "normal"}; font-family: ${fontFamily}; font-size: ${fontSize}px; font-weight: ${Number(captionStyle.font_weight ?? 700)}; line-height: 1.22; letter-spacing: .01em; -webkit-text-stroke: ${Number(captionStyle.stroke_width_px ?? 1.5)}px ${escHtml(captionStyle.stroke_color || "rgba(12, 11, 9, .86)")}; paint-order: stroke fill; text-shadow: 0 2px 3px rgba(0,0,0,.9), 0 5px 14px rgba(0,0,0,.68); will-change: transform, opacity; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-no-timeline data-start="0" data-duration="${fmt(duration)}" data-width="${width}" data-height="${height}" data-fps="${fps}">
      <div id="canvas-bg" class="clip canvas-bg" data-start="0" data-duration="${fmt(duration)}" data-track-index="0" aria-hidden="true"></div>
${sceneMarkup.join("\n")}
${captionMarkup.join("\n")}
      <audio id="narration" class="clip" src="${audioAsset}" data-start="0" data-duration="${fmt(duration)}" data-track-index="30" data-media-start="0" data-volume="1"></audio>
    </div>
    <script>
      function addAnimation(selector, keyframes, options) {
        const element = document.querySelector(selector);
        if (!element) throw new Error("Animation target missing: " + selector);
        const animation = element.animate(keyframes, { ...options, iterations: 1 });
        animation.pause();
        return animation;
      }
${animationLines.join("\n")}
    </script>
  </body>
</html>`);

    const assertions = [];
    if (captions.length > 0) {
      assertions.push({ kind: "appearsBy", selector: `#${slugify(captions[0].id || "caption-1")} .caption-text`, bySec: Math.min(duration, Number(captions[0].start) + 0.5) });
    }
    write(tempRoot, "index.motion.json", JSON.stringify({ duration, assertions }, null, 2));
    write(tempRoot, "BRIEF.md", `
---
workflow: general-video
flow: automation
storyboard: no
destination: ${state.intake?.publishing_platform || "unspecified"}
aspect: ${width}x${height}
language: ${project.language || "zh-CN"}
length: ${duration}s
---

## Intent

${state.intake?.goal || project.title || "旁白驱动视觉视频"}

## Production

- mode: ${mode}
- narration: ${path.basename(audioAsset)}
- scenes: ${scenes.length}
- captions: ${captions.length}
- required runtime assets are copied under \`assets/\`; the composition HTML has no animation-library network dependency.
`);
    write(tempRoot, "STORYBOARD.md", `
---
format: ${width}x${height}
duration: ${duration}s
mode: autonomous
---

${storyboardLines.join("\n\n")}
`);
    write(tempRoot, "frame.md", `
# Visual design

- style: ${state.style_profile?.name || "project-approved style"}
- visual language: ${state.style_profile?.visual_language || "see video-project.json"}
- production mode: ${mode}
- motion profile: ${profile.name || "restrained-camera"}
- transition: crossfade ${transitionDuration}s
- captions: ${captionsConfig.enabled ? captionStyle.preset || "project-configured" : "disabled"}
`);

    const backup = finalize(tempRoot, outputDir, args.replaceGenerated);
    console.log(JSON.stringify({
      output: outputDir,
      backup,
      mode,
      scenes: scenes.length,
      captions: captions.length,
      hyperframesVersion: version,
      runtimeAnimation: "waapi-local-no-animation-library-fetch",
      warnings: fontAsset ? [] : ["caption font is not pinned; cross-machine text layout may differ"],
    }, null, 2));
  } catch (error) {
    if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
