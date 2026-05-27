#!/usr/bin/env node
// convert-mixamo-pack.cjs
//
// Walks an FBX folder, runs Blender headless on each file via fbx-to-bvh.py,
// outputs cleaned .bvh files into frontend/public/animations/.
// Filenames are sanitized: "Hip Hop Dancing (2).fbx" → "mixamo_hip_hop_dancing_2.bvh"
//
// Writes scripts/mixamo-manifest.json with per-clip results for the
// downstream wire-up step.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = process.argv[2] || "C:\\Users\\matto\\Downloads\\fbx motions";
const OUT_DIR = path.join(ROOT, "frontend", "public", "animations");

// Find Blender. winget installs to %ProgramFiles%\Blender Foundation\Blender X.Y\blender.exe
function findBlender() {
  const candidates = [
    "C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe",
    "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe",
    "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe",
    "C:\\Program Files\\Blender Foundation\\Blender\\blender.exe",
  ];
  // Also probe LTS subdirs
  const ltsRoot = "C:\\Program Files\\Blender Foundation";
  if (fs.existsSync(ltsRoot)) {
    for (const entry of fs.readdirSync(ltsRoot)) {
      const exe = path.join(ltsRoot, entry, "blender.exe");
      if (fs.existsSync(exe) && !candidates.includes(exe)) candidates.push(exe);
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function sanitize(name) {
  return (
    "mixamo_" +
    name
      .replace(/\.fbx$/i, "")
      .toLowerCase()
      .replace(/[^\w]+/g, "_")
      .replace(/^_+|_+$/g, "")
  );
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Source folder not found: ${SRC_DIR}`);
    process.exit(2);
  }
  const blender = findBlender();
  if (!blender) {
    console.error("Blender not found. Install via: winget install BlenderFoundation.Blender.LTS.4.5");
    process.exit(2);
  }
  console.log(`Using Blender: ${blender}`);

  const script = path.join(__dirname, "fbx-to-bvh.py");

  const files = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.toLowerCase().endsWith(".fbx"))
    .sort();

  console.log(`Found ${files.length} FBX files in ${SRC_DIR}`);

  const results = [];
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const inputFbx = path.join(SRC_DIR, file);
    const friendlyBase = sanitize(file);
    const outputBvh = path.join(OUT_DIR, `${friendlyBase}.bvh`);

    process.stdout.write(`[${i + 1}/${files.length}] ${file} → ${friendlyBase}.bvh ... `);

    if (fs.existsSync(outputBvh)) {
      process.stdout.write("exists, skip\n");
      results.push({ src: file, name: friendlyBase, file: `${friendlyBase}.bvh`, skipped: true });
      continue;
    }

    const t0 = Date.now();
    const r = spawnSync(
      blender,
      ["--background", "--python", script, "--", inputFbx, outputBvh],
      { encoding: "utf8", timeout: 120_000 }
    );
    const dt = ((Date.now() - t0) / 1000).toFixed(1);

    if (r.status !== 0 || !fs.existsSync(outputBvh)) {
      console.log(`FAIL (${dt}s)`);
      const stderr = (r.stderr || "").split("\n").filter((l) => l.includes("ERROR") || l.includes("FAIL")).slice(0, 3).join(" | ");
      errors.push({ src: file, error: stderr || `exit ${r.status}` });
      continue;
    }

    const size = fs.statSync(outputBvh).size;
    console.log(`OK  ${(size / 1024).toFixed(0)} KB  (${dt}s)`);
    results.push({
      src: file,
      name: friendlyBase,
      file: `${friendlyBase}.bvh`,
      sizeBytes: size,
    });
  }

  const ok = results.filter((r) => !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\nDone. converted=${ok} skipped=${skipped} failed=${errors.length}`);

  fs.writeFileSync(
    path.join(__dirname, "mixamo-manifest.json"),
    JSON.stringify({ generated: new Date().toISOString(), source: SRC_DIR, results, errors }, null, 2)
  );
  console.log("Wrote scripts/mixamo-manifest.json");
}

main();
