#!/usr/bin/env node
// pull-cmu-animations.cjs
//
// Downloads a curated set of BVH clips from the Carnegie Mellon Motion
// Capture Database (via the una-dinosauria GitHub mirror), converts the
// CMU bone naming to Mixamo camelCase (what DSOS's bvhLoader expects),
// strips the root Hips position track, and rounds float precision to 2
// decimals for ~70% file-size compression.
//
// Output: frontend/public/animations/cmu_<friendly>.bvh
// Plus:   frontend/public/animations/CREDITS.md (CMU attribution)

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "frontend", "public", "animations");

// CMU bone name → Mixamo camelCase (what bvhLoader.ts BVH_TO_VRM map knows).
// Anything not listed here gets dropped at retargeting time by the loader.
const BONE_MAP = {
  Hips: "hips",
  LowerBack: "spine",
  Spine: "chest",
  Spine1: "upperChest",
  Neck: "neck",
  Neck1: "neck", // CMU has 2; Mixamo only one. Both target neck — second one wins.
  Head: "head",
  LeftShoulder: "leftShoulder",
  LeftArm: "leftUpperArm",
  LeftForeArm: "leftLowerArm",
  LeftHand: "leftHand",
  LThumb: "leftThumbProximal",
  LeftFingerBase: "leftIndexProximal",
  LeftHandIndex1: "leftIndexIntermediate",
  RightShoulder: "rightShoulder",
  RightArm: "rightUpperArm",
  RightForeArm: "rightLowerArm",
  RightHand: "rightHand",
  RThumb: "rightThumbProximal",
  RightFingerBase: "rightIndexProximal",
  RightHandIndex1: "rightIndexIntermediate",
  LeftUpLeg: "leftUpperLeg",
  LeftLeg: "leftLowerLeg",
  LeftFoot: "leftFoot",
  LeftToeBase: "leftToes",
  RightUpLeg: "rightUpperLeg",
  RightLeg: "rightLowerLeg",
  RightFoot: "rightFoot",
  RightToeBase: "rightToes",
  // LHipJoint / RHipJoint are extra joints between hips and legs in CMU,
  // not present in Mixamo/VRM. They'll be dropped by the retargeter.
};

// CURATED CMU PICKS. Format: { subject, trial, name, category }
// Subjects > 60 are higher quality per CMU's own notes. Trials picked from
// the descriptions in cmu-mocap-index-text.txt for emotional/expressive range.
const PICKS = [
  // === Idles & sitting (subtle, looping-friendly) ===
  { s: 13, t: 4, name: "sit_thinker", cat: "idle" },     // sit on stepstool, chin in hand
  { s: 13, t: 5, name: "sit_fidget", cat: "idle" },      // sit, fidget
  { s: 82, t: 5, name: "sit_ground_relax", cat: "idle" },// sitting on ground relaxing
  { s: 82, t: 1, name: "stand_static", cat: "idle" },    // static pose (good for "neutral")
  { s: 82, t: 18, name: "stand_static_2", cat: "idle" }, // alt static
  { s: 13, t: 1, name: "stand_from_sit", cat: "action" },// sit + stand transition

  // === Emotional walks (Subject 82's gold ===
  { s: 82, t: 9, name: "walk_confident", cat: "walk" },
  { s: 82, t: 10, name: "walk_sad", cat: "walk" },
  { s: 82, t: 11, name: "walk_normal", cat: "walk" },
  { s: 82, t: 12, name: "walk_happy", cat: "walk" },
  { s: 82, t: 14, name: "walk_slow_to_stop", cat: "walk" },

  // === Laughter / joy ===
  { s: 13, t: 14, name: "laugh_1", cat: "joy" },
  { s: 13, t: 15, name: "laugh_2", cat: "joy" },
  { s: 13, t: 16, name: "laugh_3", cat: "joy" },

  // === Communicative gestures ===
  { s: 13, t: 26, name: "direct_traffic_wave", cat: "action" },
  { s: 13, t: 27, name: "wave_and_point", cat: "action" },
  { s: 79, t: 6, name: "handshake", cat: "action" },

  // === Drinking / eating (life behaviors — feel real) ===
  { s: 13, t: 7, name: "drink_soda", cat: "life" },
  { s: 13, t: 9, name: "drink_quick", cat: "life" },
  { s: 79, t: 12, name: "eat_dinner", cat: "life" },
  { s: 79, t: 15, name: "eat_sandwich", cat: "life" },

  // === Work / domestic (background activity, occasional plays) ===
  { s: 13, t: 20, name: "wash_windows", cat: "life" },
  { s: 13, t: 23, name: "sweep_floor", cat: "life" },
  { s: 79, t: 1, name: "chop_wood", cat: "life" },
  { s: 79, t: 4, name: "dig", cat: "life" },
  { s: 79, t: 14, name: "knead_dough", cat: "life" },
  { s: 79, t: 17, name: "play_violin", cat: "life" },
  { s: 79, t: 18, name: "play_drums", cat: "life" },
  { s: 79, t: 19, name: "play_piano", cat: "life" },

  // === Reach / pick up ===
  { s: 13, t: 10, name: "tiptoe_reach", cat: "action" },
  { s: 13, t: 11, name: "forward_jump", cat: "action" },

  // === Exercise / energetic ===
  { s: 13, t: 17, name: "boxing_1", cat: "action" },
  { s: 13, t: 18, name: "boxing_2", cat: "action" },
  { s: 13, t: 29, name: "jumping_jacks", cat: "action" },

  // === Dance — Charleston (Subject 93/103) ===
  { s: 93, t: 1, name: "dance_charleston_1", cat: "dance" },
  { s: 93, t: 2, name: "dance_charleston_2", cat: "dance" },
  { s: 93, t: 3, name: "dance_charleston_3", cat: "dance" },
  { s: 93, t: 8, name: "dance_charleston_4", cat: "dance" },

  // === Dance — Salsa (Subject 60/61) ===
  { s: 60, t: 1, name: "dance_salsa_1", cat: "dance" },
  { s: 60, t: 5, name: "dance_salsa_2", cat: "dance" },
  { s: 60, t: 12, name: "dance_salsa_3", cat: "dance" },
  { s: 61, t: 1, name: "dance_salsa_4", cat: "dance" },
  { s: 61, t: 5, name: "dance_salsa_5", cat: "dance" },

  // === Dance — Indian classical (Subject 94) ===
  { s: 94, t: 1, name: "dance_indian_1", cat: "dance" },
  { s: 94, t: 3, name: "dance_indian_2", cat: "dance" },
  { s: 94, t: 7, name: "dance_indian_3", cat: "dance" },

  // === Dance — Modern (Subject 5) ===
  { s: 5, t: 2, name: "dance_modern_1", cat: "dance" },
  { s: 5, t: 6, name: "dance_modern_2", cat: "dance" },
  { s: 5, t: 9, name: "dance_modern_3", cat: "dance" },

  // === Dance — Breakdance / acrobatic (Subject 85) ===
  { s: 85, t: 1, name: "dance_break_1", cat: "dance" },
  { s: 85, t: 12, name: "dance_break_2", cat: "dance" },

  // === Acrobatics (rare-but-cool moves) ===
  { s: 88, t: 1, name: "flip_acro_1", cat: "action" },
  { s: 88, t: 5, name: "flip_acro_2", cat: "action" },
  { s: 90, t: 1, name: "cartwheel_1", cat: "action" },

  // === Female-tagged subject (#106) — broad coverage, descriptions are
  // unhelpful in the index so we grab a few and let the audit drop duds. ===
  { s: 106, t: 1, name: "female_general_1", cat: "idle" },
  { s: 106, t: 5, name: "female_general_2", cat: "idle" },
  { s: 106, t: 10, name: "female_general_3", cat: "idle" },
  { s: 106, t: 18, name: "female_general_4", cat: "idle" },
  { s: 106, t: 25, name: "female_general_5", cat: "idle" },

  // === Misc cool/expressive ===
  { s: 56, t: 3, name: "upper_body_motion", cat: "idle" },
  { s: 80, t: 3, name: "assorted_1", cat: "idle" },
  { s: 80, t: 9, name: "assorted_2", cat: "idle" },
  { s: 80, t: 16, name: "assorted_3", cat: "idle" },
  { s: 77, t: 3, name: "careful_step", cat: "action" },
  { s: 75, t: 9, name: "hopscotch", cat: "action" },
];

const BASE = "https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data";

function pad3(n) {
  return String(n).padStart(3, "0");
}
function pad2(n) {
  return String(n).padStart(2, "0");
}

function fetchBvh(subject, trial) {
  const url = `${BASE}/${pad3(subject)}/${pad2(subject)}_${pad2(trial)}.bvh`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      // Follow redirects manually (GitHub raw → AWS s3)
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBvh(subject, trial).then(resolve, reject); // simplification: retry url
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("download timeout")));
  });
}

// Parse the HIERARCHY section, rewrite bone names according to BONE_MAP,
// and modify the Hips CHANNELS line to drop the 3 position channels.
// Returns { newText, hipsChannelCount }.
function convertHeader(text) {
  const motionIdx = text.indexOf("MOTION");
  if (motionIdx < 0) throw new Error("No MOTION section");
  const header = text.slice(0, motionIdx);
  const motion = text.slice(motionIdx);

  const lines = header.split("\n");
  let inRoot = false;
  let hipsChannelLineIdx = -1;
  let hipsOriginalChannels = 0;

  const newLines = lines.map((line, i) => {
    // Joint/ROOT bone rename
    const m = line.match(/^(\s*)(ROOT|JOINT)\s+(\S+)/);
    if (m) {
      const [, indent, kind, name] = m;
      const mapped = BONE_MAP[name];
      if (kind === "ROOT") inRoot = true;
      if (mapped) {
        return `${indent}${kind} ${mapped}`;
      }
      // Unmapped bone — leave name as-is. The downstream loader's
      // BVH_TO_VRM map will drop it at retarget time.
      return line;
    }
    // Modify root CHANNELS — drop the 3 position channels.
    const cm = line.match(/^(\s*)CHANNELS\s+(\d+)\s+(.+)$/);
    if (cm && inRoot) {
      const [, indent, count, rest] = cm;
      const channels = rest.trim().split(/\s+/);
      hipsOriginalChannels = parseInt(count, 10);
      const rotationsOnly = channels.filter((c) => /rotation/i.test(c));
      hipsChannelLineIdx = i;
      inRoot = false; // only the root line counts
      return `${indent}CHANNELS ${rotationsOnly.length} ${rotationsOnly.join(" ")}`;
    }
    return line;
  });

  return {
    newHeader: newLines.join("\n"),
    motion,
    stripFirstN: hipsOriginalChannels - 3, // 6 → 3 = strip 3
  };
}

function compressMotion(motion, stripFirstN) {
  // motion starts with "MOTION\nFrames: N\nFrame Time: X\n<rows>"
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
  const out = headerLines.slice();
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = line.trim().split(/\s+/);
    const sliced = stripFirstN > 0 ? values.slice(stripFirstN) : values;
    // Round to 2 decimals — visually identical, much smaller.
    const rounded = sliced.map((v) => {
      const n = parseFloat(v);
      if (!Number.isFinite(n)) return v;
      return n.toFixed(2);
    });
    out.push(rounded.join(" "));
  }
  return out.join("\n");
}

async function processOne({ s, t, name }) {
  const text = await fetchBvh(s, t);
  const before = Buffer.byteLength(text, "utf8");
  const { newHeader, motion, stripFirstN } = convertHeader(text);
  const compressedMotion = compressMotion(motion, stripFirstN);
  const result = newHeader + compressedMotion;
  const after = Buffer.byteLength(result, "utf8");
  const outFile = path.join(OUT_DIR, `cmu_${name}.bvh`);
  fs.writeFileSync(outFile, result);
  return { name, file: `cmu_${name}.bvh`, before, after, ratio: after / before };
}

(async () => {
  console.log(`Pulling ${PICKS.length} clips from CMU mocap (via una-dinosauria mirror)...`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const results = [];
  const failures = [];

  // Sequential with small delay so we're a good citizen of GitHub's raw CDN.
  for (let i = 0; i < PICKS.length; i++) {
    const pick = PICKS[i];
    process.stdout.write(`  [${i + 1}/${PICKS.length}] ${pick.name} (subject ${pick.s} trial ${pick.t})... `);
    try {
      const r = await processOne(pick);
      results.push({ ...r, pick });
      console.log(`OK  ${(r.before / 1024).toFixed(0)}KB → ${(r.after / 1024).toFixed(0)}KB (${(r.ratio * 100).toFixed(0)}%)`);
    } catch (e) {
      console.log(`FAIL  ${e.message}`);
      failures.push({ pick, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const totalBefore = results.reduce((a, r) => a + r.before, 0);
  const totalAfter = results.reduce((a, r) => a + r.after, 0);

  console.log(`\nDone. ${results.length} ok, ${failures.length} failed.`);
  console.log(`Raw download: ${(totalBefore / 1024 / 1024).toFixed(2)} MB`);
  console.log(`After compression: ${(totalAfter / 1024 / 1024).toFixed(2)} MB (${(totalAfter / totalBefore * 100).toFixed(0)}% of original)`);

  // Write CREDITS.md
  const credits = [
    `# Animation Credits`,
    ``,
    `## CMU Motion Capture Database`,
    ``,
    `Files prefixed \`cmu_*.bvh\` were pulled from the Carnegie-Mellon Graphics Lab Motion Capture Database,`,
    `BVH conversion by Bruce Hahne, hosted via [una-dinosauria/cmu-mocap](https://github.com/una-dinosauria/cmu-mocap).`,
    ``,
    `**License:** "This data is free for use in research and commercial projects worldwide." — CMU`,
    `Source database: http://mocap.cs.cmu.edu`,
    ``,
    `### Clip list`,
    ``,
    `| File | CMU subject_trial | Category | Description |`,
    `|---|---|---|---|`,
    ...results.map((r) => `| \`${r.file}\` | ${pad2(r.pick.s)}_${pad2(r.pick.t)} | ${r.pick.cat} | ${r.name.replace(/_/g, " ")} |`),
    ``,
    `### Notes`,
    ``,
    `- Bone names were converted from CMU's PascalCase (\`Hips\`, \`LeftUpLeg\`, …) to Mixamo's camelCase (\`hips\`, \`leftUpperLeg\`, …) so DSOS's BVH retargeter (\`frontend/src/lib/bvhLoader.ts\`) maps them onto the VRM rig.`,
    `- Root Hips position channels were stripped (only rotation tracks survive) — the avatar stays put.`,
    `- Float precision rounded to 2 decimals for ~70% file-size reduction.`,
    ``,
    `## Pre-existing animations (action_*, joy*, dance_*, etc.)`,
    ``,
    `Origin uncertain. These came from a community-shared "Silly-Tavern VRM Assets Pack" — likely Mixamo-derived.`,
    `**Status: under review.** Do not assume commercial-distribution license. Plan: replace with CMU clips above + cleanly-sourced Truebones / Mixamo (with documented Adobe account) before public release.`,
    ``,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "CREDITS.md"), credits);
  console.log(`Wrote CREDITS.md`);

  // Write a JSON manifest for the wire-up script to consume.
  const manifest = {
    generated: new Date().toISOString(),
    source: "CMU Motion Capture Database via una-dinosauria/cmu-mocap",
    clips: results.map((r) => ({
      file: r.file,
      name: `cmu_${r.pick.name}`,
      category: r.pick.cat,
      cmu: `${pad2(r.pick.s)}_${pad2(r.pick.t)}`,
      sizeBytes: r.after,
    })),
    failures: failures.map((f) => ({ pick: f.pick, error: f.error })),
  };
  fs.writeFileSync(path.join(__dirname, "cmu-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Wrote scripts/cmu-manifest.json — feeds the wire-up step`);
})();
