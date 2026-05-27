#!/usr/bin/env node
// audit-animations.cjs
// Walks frontend/public/animations/, cross-references against the
// ANIMATIONS const in bvhLoader.ts, parses each BVH header, computes
// a content signature, and reports keep/cull/dupe/broken.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const ANIM_DIR = path.join(ROOT, "frontend", "public", "animations");
const LOADER_FILE = path.join(ROOT, "frontend", "src", "lib", "bvhLoader.ts");

// ---- parse the ANIMATIONS const out of bvhLoader.ts to learn what's used
function parseReferenced() {
  const src = fs.readFileSync(LOADER_FILE, "utf8");
  const start = src.indexOf("export const ANIMATIONS = {");
  if (start < 0) throw new Error("ANIMATIONS const not found");
  const end = src.indexOf("} as const;", start);
  const body = src.slice(start, end);
  const referenced = new Set();
  for (const m of body.matchAll(/"([^"]+\.bvh)"/g)) referenced.add(m[1]);
  return referenced;
}

// ---- parse the BVH_TO_VRM map so we can validate bone coverage
function parseBoneMap() {
  const src = fs.readFileSync(LOADER_FILE, "utf8");
  const start = src.indexOf("const BVH_TO_VRM");
  const end = src.indexOf("};", start);
  const body = src.slice(start, end);
  const bones = new Set();
  for (const m of body.matchAll(/^\s*([a-zA-Z]+):/gm)) bones.add(m[1]);
  return bones;
}

// ---- BVH parser (header + motion frames)
function parseBvh(text) {
  const lines = text.split(/\r?\n/);
  const joints = [];
  let depth = 0;
  let inMotion = false;
  let frameCount = 0;
  let frameTime = 0;
  const motionLines = [];
  let totalChannels = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    if (!inMotion) {
      const jMatch = line.match(/^(?:ROOT|JOINT)\s+(\S+)/);
      if (jMatch) {
        joints.push({ name: jMatch[1], depth });
        continue;
      }
      if (line === "{") {
        depth++;
        continue;
      }
      if (line === "}") {
        depth--;
        continue;
      }
      const cMatch = line.match(/^CHANNELS\s+(\d+)/);
      if (cMatch) {
        totalChannels += parseInt(cMatch[1], 10);
        continue;
      }
      if (line === "MOTION") {
        inMotion = true;
        continue;
      }
    } else {
      const fcMatch = line.match(/^Frames:\s+(\d+)/);
      if (fcMatch) {
        frameCount = parseInt(fcMatch[1], 10);
        continue;
      }
      const ftMatch = line.match(/^Frame Time:\s+([0-9.eE+-]+)/);
      if (ftMatch) {
        frameTime = parseFloat(ftMatch[1]);
        continue;
      }
      // motion data row
      if (line[0] && (line[0] === "-" || (line[0] >= "0" && line[0] <= "9"))) {
        motionLines.push(line);
      }
    }
  }

  return {
    joints,
    totalChannels,
    frameCount,
    frameTime,
    duration: frameCount * frameTime,
    motionLines,
  };
}

// ---- compute a content signature that ignores trivial precision diffs
// Take the first frame, the middle frame, and the last frame; round each
// number to 1 decimal; hash that. Identical clips → identical hash.
function contentSignature(parsed) {
  const ml = parsed.motionLines;
  if (ml.length === 0) return "empty";
  const pick = [0, Math.floor(ml.length / 2), ml.length - 1];
  const rows = pick.map((i) =>
    ml[i]
      .split(/\s+/)
      .map((n) => parseFloat(n).toFixed(1))
      .join(",")
  );
  return crypto
    .createHash("sha1")
    .update(`${parsed.joints.length}|${parsed.frameCount}|${rows.join("|")}`)
    .digest("hex")
    .slice(0, 16);
}

// ---- detect "T-pose only" — all motion rows look near-identical
function looksStatic(parsed) {
  const ml = parsed.motionLines;
  if (ml.length < 3) return true;
  // Sample 6 frames evenly. If the std-dev across them is near zero, it's static.
  const samples = [];
  const step = Math.max(1, Math.floor(ml.length / 6));
  for (let i = 0; i < ml.length; i += step) {
    samples.push(ml[i].split(/\s+/).map(Number));
  }
  if (samples.length < 2) return true;
  const len = samples[0].length;
  let maxVariance = 0;
  for (let col = 0; col < len; col++) {
    const vals = samples.map((s) => s[col]).filter((v) => Number.isFinite(v));
    if (vals.length < 2) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance =
      vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length;
    if (variance > maxVariance) maxVariance = variance;
  }
  return maxVariance < 0.01;
}

// ---- main
function main() {
  const referenced = parseReferenced();
  const knownBones = parseBoneMap();
  const files = fs
    .readdirSync(ANIM_DIR)
    .filter((f) => f.toLowerCase().endsWith(".bvh"))
    .sort();

  const reports = [];
  for (const file of files) {
    const fullPath = path.join(ANIM_DIR, file);
    const stat = fs.statSync(fullPath);
    let parsed, sig, problems = [], boneCoverage = 0;
    try {
      const text = fs.readFileSync(fullPath, "utf8");
      parsed = parseBvh(text);
      sig = contentSignature(parsed);
      const mappable = parsed.joints.filter((j) => knownBones.has(j.name)).length;
      boneCoverage = parsed.joints.length
        ? mappable / parsed.joints.length
        : 0;
      if (parsed.frameCount === 0) problems.push("no-frames");
      if (parsed.duration < 0.5) problems.push("too-short");
      if (parsed.duration > 60) problems.push("too-long");
      if (boneCoverage < 0.6) problems.push(`low-bone-coverage(${(boneCoverage*100).toFixed(0)}%)`);
      if (looksStatic(parsed)) problems.push("static-pose");
    } catch (e) {
      problems.push(`parse-error: ${e.message}`);
      sig = "error";
    }

    reports.push({
      file,
      size: stat.size,
      referenced: referenced.has(file),
      frames: parsed?.frameCount ?? 0,
      duration: parsed?.duration?.toFixed(2) ?? "?",
      joints: parsed?.joints.length ?? 0,
      boneCoverage: (boneCoverage * 100).toFixed(0) + "%",
      sig,
      problems,
    });
  }

  // group dupes by signature
  const bySig = new Map();
  for (const r of reports) {
    if (!bySig.has(r.sig)) bySig.set(r.sig, []);
    bySig.get(r.sig).push(r);
  }
  const dupeSigs = new Set(
    [...bySig.entries()].filter(([, group]) => group.length > 1).map(([s]) => s)
  );

  // categorize
  const KEEP = [];
  const CULL_UNUSED = [];
  const CULL_BROKEN = [];
  const REVIEW_DUPE = [];
  const REVIEW_SHORT_STATIC = [];

  for (const r of reports) {
    if (r.problems.some((p) => p.startsWith("parse-error") || p === "no-frames")) {
      CULL_BROKEN.push(r);
      continue;
    }
    if (!r.referenced) {
      CULL_UNUSED.push(r);
      continue;
    }
    if (dupeSigs.has(r.sig)) {
      REVIEW_DUPE.push(r);
      continue;
    }
    if (r.problems.includes("static-pose") || r.problems.includes("too-short")) {
      REVIEW_SHORT_STATIC.push(r);
      continue;
    }
    KEEP.push(r);
  }

  // output
  const totalBytes = reports.reduce((a, r) => a + r.size, 0);
  const cullableBytes =
    [...CULL_UNUSED, ...CULL_BROKEN].reduce((a, r) => a + r.size, 0);

  console.log("═══ BVH ANIMATION AUDIT ═══");
  console.log(`Folder: ${ANIM_DIR}`);
  console.log(`Total files: ${reports.length}`);
  console.log(`Total size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Cullable size (unused + broken): ${(cullableBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Referenced in code: ${referenced.size}`);
  console.log();

  function section(title, rows) {
    console.log(`──── ${title} (${rows.length}) ────`);
    if (rows.length === 0) {
      console.log("  (none)");
      console.log();
      return;
    }
    for (const r of rows.slice(0, 200)) {
      const probs = r.problems.length ? `  [${r.problems.join(", ")}]` : "";
      console.log(
        `  ${r.file.padEnd(38)}  ${String(r.duration).padStart(6)}s  ${String(r.frames).padStart(5)}f  ${r.boneCoverage.padStart(4)} bones${probs}`
      );
    }
    if (rows.length > 200) console.log(`  ... and ${rows.length - 200} more`);
    console.log();
  }

  section("✅ KEEP (referenced, healthy)", KEEP);
  section("❌ CULL — unused (not referenced anywhere in code)", CULL_UNUSED);
  section("❌ CULL — broken (parse error or zero frames)", CULL_BROKEN);
  section("⚠ REVIEW — duplicates (referenced + has another file with same content)", REVIEW_DUPE);
  section("⚠ REVIEW — too short or static pose (referenced)", REVIEW_SHORT_STATIC);

  // dupe groups (show which files match which)
  const dupeGroups = [...bySig.entries()].filter(([, g]) => g.length > 1);
  if (dupeGroups.length) {
    console.log("──── DUPE GROUPS (same content signature) ────");
    for (const [sig, group] of dupeGroups) {
      console.log(`  sig=${sig}`);
      for (const r of group) {
        const tag = r.referenced ? "REF" : "   ";
        console.log(`    ${tag}  ${r.file}`);
      }
    }
    console.log();
  }

  // Save machine-readable JSON next to this script for any later pruning tooling.
  const outFile = path.join(__dirname, "audit-animations.json");
  fs.writeFileSync(outFile, JSON.stringify({ reports, KEEP: KEEP.map(r => r.file), CULL_UNUSED: CULL_UNUSED.map(r => r.file), CULL_BROKEN: CULL_BROKEN.map(r => r.file), REVIEW_DUPE: REVIEW_DUPE.map(r => r.file), REVIEW_SHORT_STATIC: REVIEW_SHORT_STATIC.map(r => r.file) }, null, 2));
  console.log(`Machine-readable report: ${outFile}`);
}

main();
