#!/usr/bin/env node
// pull-cmu-bulk.cjs
//
// Bulk-pull every trial from the dance + female CMU subjects. Converts
// CMU bone names to Mixamo camelCase, strips Hips position, rounds to 2
// decimals, and — critically — analyzes each clip's MOTION CONTENT so we
// can auto-classify what it actually is (idle / gentle / walk / active /
// energetic / static), since CMU's text descriptions are useless for many.

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "frontend", "public", "animations");

// Same bone map as the curated puller — keeps clips compatible with the
// existing retargeter.
const BONE_MAP = {
  Hips: "hips", LowerBack: "spine", Spine: "chest", Spine1: "upperChest",
  Neck: "neck", Neck1: "neck", Head: "head",
  LeftShoulder: "leftShoulder", LeftArm: "leftUpperArm",
  LeftForeArm: "leftLowerArm", LeftHand: "leftHand",
  LThumb: "leftThumbProximal", LeftFingerBase: "leftIndexProximal",
  LeftHandIndex1: "leftIndexIntermediate",
  RightShoulder: "rightShoulder", RightArm: "rightUpperArm",
  RightForeArm: "rightLowerArm", RightHand: "rightHand",
  RThumb: "rightThumbProximal", RightFingerBase: "rightIndexProximal",
  RightHandIndex1: "rightIndexIntermediate",
  LeftUpLeg: "leftUpperLeg", LeftLeg: "leftLowerLeg",
  LeftFoot: "leftFoot", LeftToeBase: "leftToes",
  RightUpLeg: "rightUpperLeg", RightLeg: "rightLowerLeg",
  RightFoot: "rightFoot", RightToeBase: "rightToes",
};

// Which body part each retargeted bone belongs to (for limb-activity analysis)
function bodyPart(boneName) {
  if (/Arm|Hand|Shoulder|Thumb|Finger|Index/.test(boneName)) return "arms";
  if (/Leg|Foot|Toe/.test(boneName)) return "legs";
  if (/spine|chest|hips|head|neck/i.test(boneName)) return "torso";
  return "other";
}

// All trials for the 16 dance + female subjects
const TARGET_SUBJECTS = {
  5:   { tag: "modern_dance",   trials: 20, friendlyCat: "dance_modern" },
  12:  { tag: "tai_chi",        trials: 4,  friendlyCat: "tai_chi" },
  15:  { tag: "dance_moves",    trials: 14, friendlyCat: "dance_misc" },
  49:  { tag: "modern_dance",   trials: 22, friendlyCat: "dance_modern" },
  60:  { tag: "salsa",          trials: 15, friendlyCat: "dance_salsa" },
  61:  { tag: "salsa",          trials: 15, friendlyCat: "dance_salsa" },
  85:  { tag: "breakdance",     trials: 15, friendlyCat: "dance_break" },
  90:  { tag: "acro_dance",     trials: 36, friendlyCat: "dance_acro" },
  93:  { tag: "charleston",     trials: 8,  friendlyCat: "dance_charleston" },
  94:  { tag: "indian_dance",   trials: 16, friendlyCat: "dance_indian" },
  103: { tag: "charleston",     trials: 8,  friendlyCat: "dance_charleston" },
  106: { tag: "female",         trials: 34, friendlyCat: "female_general" },
  111: { tag: "pregnant",       trials: 41, friendlyCat: "female_pregnant" },
  113: { tag: "post_pregnant",  trials: 29, friendlyCat: "female_postpartum" },
  114: { tag: "pregnant",       trials: 16, friendlyCat: "female_pregnant" },
  144: { tag: "punching_female",trials: 34, friendlyCat: "female_punch" },
};

const BASE = "https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data";
const pad3 = (n) => String(n).padStart(3, "0");
const pad2 = (n) => String(n).padStart(2, "0");

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return get(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(45000, () => req.destroy(new Error("timeout")));
  });
}

// ---- BVH conversion (header bones + Hips channels + motion compression)
function convertHeader(text) {
  const motionIdx = text.indexOf("MOTION");
  if (motionIdx < 0) throw new Error("no MOTION");
  const header = text.slice(0, motionIdx);
  const motion = text.slice(motionIdx);
  const lines = header.split("\n");
  let inRoot = false;
  let hipsOriginalChannels = 0;

  const newLines = lines.map((line) => {
    const m = line.match(/^(\s*)(ROOT|JOINT)\s+(\S+)/);
    if (m) {
      const [, indent, kind, name] = m;
      const mapped = BONE_MAP[name];
      if (kind === "ROOT") inRoot = true;
      return mapped ? `${indent}${kind} ${mapped}` : line;
    }
    const cm = line.match(/^(\s*)CHANNELS\s+(\d+)\s+(.+)$/);
    if (cm && inRoot) {
      const [, indent, count, rest] = cm;
      const channels = rest.trim().split(/\s+/);
      hipsOriginalChannels = parseInt(count, 10);
      const rotationsOnly = channels.filter((c) => /rotation/i.test(c));
      inRoot = false;
      return `${indent}CHANNELS ${rotationsOnly.length} ${rotationsOnly.join(" ")}`;
    }
    return line;
  });

  return {
    newHeader: newLines.join("\n"),
    motion,
    stripFirstN: hipsOriginalChannels - 3,
  };
}

function compressMotion(motion, stripFirstN) {
  const lines = motion.split(/\r?\n/);
  const headerLines = [];
  let i = 0;
  for (; i < lines.length; i++) {
    headerLines.push(lines[i]);
    if (/^Frame Time:/.test(lines[i].trim())) {
      i++;
      break;
    }
  }
  const motionRows = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = line.trim().split(/\s+/);
    const sliced = stripFirstN > 0 ? values.slice(stripFirstN) : values;
    const rounded = sliced.map((v) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n.toFixed(2) : v;
    });
    motionRows.push(rounded.join(" "));
  }
  return { header: headerLines.join("\n"), rows: motionRows };
}

// ---- MOTION ANALYSIS — read the converted bone names + their per-frame
// rotation deltas to derive what the clip actually is.
function analyzeMotion(newHeader, motionRows, frameTime) {
  // Walk the header to learn channel order per bone
  const joints = []; // [{bvhName, mappedName, channelCount, partition}]
  const lines = newHeader.split("\n");
  let inDef = false;
  let pendingBone = null;
  for (const line of lines) {
    const m = line.match(/^\s*(ROOT|JOINT)\s+(\S+)/);
    if (m) {
      pendingBone = m[2];
      continue;
    }
    const cm = line.match(/^\s*CHANNELS\s+(\d+)/);
    if (cm && pendingBone) {
      const cnt = parseInt(cm[1], 10);
      joints.push({ name: pendingBone, channelCount: cnt, part: bodyPart(pendingBone) });
      pendingBone = null;
    }
  }

  const totalChannels = joints.reduce((a, j) => a + j.channelCount, 0);

  // Parse motion rows as numbers
  const frames = motionRows.map((row) => row.split(/\s+/).map(Number));
  if (frames.length < 2) {
    return { duration: 0, frames: 0, mean: 0, peak: 0, perPart: {}, isStatic: true };
  }

  // Per-channel deltas frame-to-frame
  let sumAbsDelta = 0;
  let peakDelta = 0;
  const partSums = { arms: 0, legs: 0, torso: 0, other: 0 };
  const partCounts = { arms: 0, legs: 0, torso: 0, other: 0 };

  for (let f = 1; f < frames.length; f++) {
    let chIdx = 0;
    for (const j of joints) {
      let jointDelta = 0;
      for (let c = 0; c < j.channelCount; c++) {
        const prev = frames[f - 1][chIdx];
        const cur = frames[f][chIdx];
        chIdx++;
        if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue;
        // Angle wrap normalize (-180..180)
        let d = cur - prev;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        const abs = Math.abs(d);
        sumAbsDelta += abs;
        jointDelta += abs;
        if (abs > peakDelta) peakDelta = abs;
      }
      partSums[j.part] += jointDelta;
      partCounts[j.part] += j.channelCount;
    }
  }

  const totalSamples = (frames.length - 1) * totalChannels;
  const mean = totalSamples ? sumAbsDelta / totalSamples : 0;
  const perPart = {};
  for (const p of Object.keys(partSums)) {
    perPart[p] = partCounts[p] ? partSums[p] / ((frames.length - 1) * partCounts[p]) : 0;
  }

  return {
    duration: frames.length * frameTime,
    frames: frames.length,
    mean,
    peak: peakDelta,
    perPart,
    isStatic: mean < 0.05,
  };
}

// ---- Heuristic classification from motion stats
function classify(stats, subjectInfo) {
  if (stats.frames < 30 || stats.duration < 0.8) return "skip_too_short";
  if (stats.isStatic) return "skip_static";

  const armsLeads = stats.perPart.arms > stats.perPart.legs * 1.4;
  const legsLeads = stats.perPart.legs > stats.perPart.arms * 1.4;

  if (stats.mean < 0.4) {
    if (legsLeads) return "walk_gentle";
    if (armsLeads) return "idle_gesture";
    return "idle";
  }
  if (stats.mean < 1.0) {
    if (legsLeads) return "walk";
    return "active";
  }
  if (stats.mean < 2.5) {
    if (subjectInfo.tag.includes("dance") || subjectInfo.tag === "tai_chi") return "dance";
    return "energetic";
  }
  // mean >= 2.5
  return subjectInfo.tag.includes("dance") || subjectInfo.tag === "breakdance" ||
         subjectInfo.tag === "acro_dance"
    ? "dance_intense"
    : "energetic";
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const all = [];
  for (const [sub, info] of Object.entries(TARGET_SUBJECTS)) {
    for (let t = 1; t <= info.trials; t++) {
      all.push({ subject: parseInt(sub, 10), trial: t, info });
    }
  }
  console.log(`Bulk-pulling ${all.length} trials across ${Object.keys(TARGET_SUBJECTS).length} subjects.\n`);

  const out = [];
  const errors = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (let i = 0; i < all.length; i++) {
    const { subject, trial, info } = all[i];
    const friendly = `cmu_${info.friendlyCat}_${pad2(subject)}_${pad2(trial)}`;
    const outFile = path.join(OUT_DIR, `${friendly}.bvh`);
    process.stdout.write(`[${i + 1}/${all.length}] ${friendly}... `);

    // Skip if file already exists from prior pull (avoids re-fetch + overwrite)
    if (fs.existsSync(outFile)) {
      process.stdout.write("exists, skip\n");
      continue;
    }

    const url = `${BASE}/${pad3(subject)}/${pad2(subject)}_${pad2(trial)}.bvh`;
    try {
      const text = await get(url);
      totalBefore += Buffer.byteLength(text, "utf8");
      const { newHeader, motion, stripFirstN } = convertHeader(text);
      const { header: motionHeader, rows } = compressMotion(motion, stripFirstN);

      // Extract Frame Time for stats
      const ftMatch = motionHeader.match(/Frame Time:\s+([0-9.eE+-]+)/);
      const frameTime = ftMatch ? parseFloat(ftMatch[1]) : 1 / 120;

      const stats = analyzeMotion(newHeader, rows, frameTime);
      const cls = classify(stats, info);

      // Cull static + too-short before writing
      if (cls.startsWith("skip_")) {
        console.log(`SKIP ${cls} (mean=${stats.mean.toFixed(3)} dur=${stats.duration.toFixed(1)}s)`);
        continue;
      }

      const fullText = newHeader + motionHeader + "\n" + rows.join("\n") + "\n";
      fs.writeFileSync(outFile, fullText);
      const after = Buffer.byteLength(fullText, "utf8");
      totalAfter += after;

      out.push({
        file: `${friendly}.bvh`,
        name: friendly,
        category: info.friendlyCat,
        subject,
        trial,
        duration: +stats.duration.toFixed(2),
        frames: stats.frames,
        meanDelta: +stats.mean.toFixed(3),
        peakDelta: +stats.peak.toFixed(3),
        arms: +stats.perPart.arms.toFixed(3),
        legs: +stats.perPart.legs.toFixed(3),
        torso: +stats.perPart.torso.toFixed(3),
        sizeKB: Math.round(after / 1024),
        classification: cls,
      });
      console.log(`OK  ${cls} ${stats.duration.toFixed(1)}s ${Math.round(after/1024)}KB mean=${stats.mean.toFixed(2)}`);
    } catch (e) {
      console.log(`FAIL ${e.message}`);
      errors.push({ subject, trial, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Summary
  const byCls = {};
  for (const o of out) {
    byCls[o.classification] = (byCls[o.classification] ?? 0) + 1;
  }
  console.log(`\n═══ Summary ═══`);
  console.log(`Downloaded + kept: ${out.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Total size: ${(totalAfter / 1024 / 1024).toFixed(1)} MB (compressed from ${(totalBefore / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`\nClassification breakdown:`);
  for (const [c, n] of Object.entries(byCls).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(20)} ${n}`);
  }

  fs.writeFileSync(
    path.join(__dirname, "cmu-bulk-manifest.json"),
    JSON.stringify({ generated: new Date().toISOString(), out, errors }, null, 2)
  );
  console.log(`\nManifest: scripts/cmu-bulk-manifest.json (feed to the wire-up script)`);
})();
