#!/usr/bin/env node
// wire-cmu-bulk.cjs
//
// Reads cmu-bulk-manifest.json, generates updated ANIMATIONS const + variant
// pool entries for bvhLoader.ts, and edits the file in place.
//
// Strategy:
// - Add every kept clip to ANIMATIONS as `<name>: "<file>"`.
// - DANCE_VARIANTS gets ALL clips from dance-tagged subjects (salsa,
//   charleston, indian, modern, break, acro_dance, tai_chi, dance_misc),
//   filtered to clips with mean delta > 0.3 (skip the warmup poses).
// - RARE_DANCE_VARIANTS gets the high-intensity ones (mean > 0.8).
// - WALK_VARIANTS gets clips classified walk/walk_gentle from female subjects.
// - IDLE_VARIANTS gets clips classified idle/idle_gesture from female subjects.
// - ENERGETIC_VARIANTS gets clips classified active/energetic from female subjects.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const LOADER = path.join(ROOT, "frontend", "src", "lib", "bvhLoader.ts");
const MANIFEST = path.join(__dirname, "cmu-bulk-manifest.json");

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const clips = manifest.out;

const DANCE_CATS = new Set([
  "dance_modern", "dance_misc", "dance_salsa", "dance_break",
  "dance_acro", "dance_charleston", "dance_indian", "tai_chi",
]);
const FEMALE_CATS = new Set([
  "female_general", "female_pregnant", "female_postpartum", "female_punch",
]);

// Categorize
const danceClips = clips.filter((c) => DANCE_CATS.has(c.category));
const femaleClips = clips.filter((c) => FEMALE_CATS.has(c.category));

const newDanceVariants = danceClips.filter((c) => c.meanDelta > 0.3 && c.duration > 2);
const newRareDance = danceClips.filter((c) => c.meanDelta > 0.8 && c.duration > 2);
const newWalkVariants = femaleClips.filter(
  (c) => (c.classification === "walk" || c.classification === "walk_gentle") && c.duration > 2
);
const newIdleVariants = femaleClips.filter(
  (c) => (c.classification === "idle" || c.classification === "idle_gesture") && c.duration > 3
);
const newEnergeticVariants = femaleClips.filter(
  (c) => (c.classification === "active" || c.classification === "energetic") && c.duration > 1.5
);

console.log(`Wiring plan:`);
console.log(`  total clips:           ${clips.length}`);
console.log(`  → ANIMATIONS entries:  ${clips.length}`);
console.log(`  → DANCE_VARIANTS+=:    ${newDanceVariants.length}`);
console.log(`  → RARE_DANCE_VARIANTS+=: ${newRareDance.length}`);
console.log(`  → WALK_VARIANTS+=:     ${newWalkVariants.length}`);
console.log(`  → IDLE_VARIANTS+=:     ${newIdleVariants.length}`);
console.log(`  → ENERGETIC_VARIANTS+=: ${newEnergeticVariants.length}`);

// Read the loader file
let src = fs.readFileSync(LOADER, "utf8");

// Generate ANIMATIONS entries
const animationEntries = clips
  .map((c) => `  ${c.name}: "${c.file}",`)
  .join("\n");

// Inject as a new section just before the closing `} as const;` of ANIMATIONS
const marker = `} as const;`;
const sectionTag = `\n\n  // ═══════ CMU bulk pull (all dance + female subjects) ═══════\n  // ${clips.length} clips. Wired by scripts/wire-cmu-bulk.cjs from cmu-bulk-manifest.json.\n${animationEntries}\n${marker}`;
src = src.replace(marker, sectionTag);

// Append to variant arrays
function addToArray(name, items) {
  const re = new RegExp(`export const ${name}: AnimationName\\[\\] = \\[([\\s\\S]*?)\\];`);
  src = src.replace(re, (_, inner) => {
    const additions = items
      .map((c) => `  "${c.name}",`)
      .join("\n");
    // Trim trailing whitespace inside the bracket
    const trimmed = inner.replace(/\s+$/, "");
    return `export const ${name}: AnimationName[] = [${trimmed}\n  // ── CMU bulk ──\n${additions}\n];`;
  });
}

addToArray("DANCE_VARIANTS", newDanceVariants);
addToArray("RARE_DANCE_VARIANTS", newRareDance);
addToArray("WALK_VARIANTS", newWalkVariants);
addToArray("IDLE_VARIANTS", newIdleVariants);
addToArray("ENERGETIC_VARIANTS", newEnergeticVariants);

fs.writeFileSync(LOADER, src);
console.log(`\nUpdated ${LOADER}`);

// Update CREDITS.md
const credits = path.join(ROOT, "frontend", "public", "animations", "CREDITS.md");
let creditsText = fs.readFileSync(credits, "utf8");

const bulkSection = `\n\n## CMU Bulk Pull (dance + female subjects)\n\nAdded by \`scripts/pull-cmu-bulk.cjs\` — ${clips.length} additional clips spanning every trial of CMU subjects:\n\n- 5, 12, 15, 49 — modern dance, tai chi, dance moves\n- 60, 61 — salsa\n- 85 — breakdance / jumps\n- 90 — cartwheels + acrobatics + dances\n- 93, 103 — Charleston\n- 94 — Indian dance\n- 106 — Female General Subject\n- 111, 114 — Pregnant Woman\n- 113 — Post-pregnant Woman\n- 144 — Punching Female\n\n**Total bulk-pull size:** ${(clips.reduce((a, c) => a + c.sizeKB, 0) / 1024).toFixed(1)} MB compressed.\n\nClips are classified by motion analysis (mean rotational delta per joint per frame, limb activity dominance) and routed into appropriate variant pools — \`DANCE_VARIANTS\`, \`RARE_DANCE_VARIANTS\` (high-intensity), \`WALK_VARIANTS\`, \`IDLE_VARIANTS\`, \`ENERGETIC_VARIANTS\` — so Oracle's auto-dance and idle behavior naturally rotates through the wider library.\n\nSee \`scripts/cmu-bulk-manifest.json\` for the full per-clip stats (duration, mean motion, peak motion, limb breakdown, classification).\n`;

if (!creditsText.includes("CMU Bulk Pull")) {
  creditsText += bulkSection;
  fs.writeFileSync(credits, creditsText);
  console.log(`Appended bulk-pull section to ${credits}`);
}
