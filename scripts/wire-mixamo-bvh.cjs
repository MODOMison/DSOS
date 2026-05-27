#!/usr/bin/env node
// wire-mixamo-bvh.cjs
//
// Reads mixamo-manifest.json, classifies each converted BVH by filename
// keywords, generates ANIMATIONS entries and variant-pool additions for
// bvhLoader.ts, and edits the file in place.
//
// Classification heuristic (filename-based):
//   contains "dance" / "dancing" / "twerk" / "salsa" / "tango" → dance
//   contains "walk" / "run" / "jog" / "catwalk" → walk
//   contains "happy" / "laugh" / "joy" / "excited" → happy
//   contains "sad" / "cry" / "grief" → sad
//   contains "angry" / "anger" / "annoy" → angry (drops into sad pool for now)
//   contains "wave" / "greet" / "salute" → greeting
//   contains "idle" / "stand" / "breath" → idle
//   contains "fall" / "die" / "hurt" → energetic
//   contains "peek" / "aim" / "focus" / "shoot" → thinking (alert)
//   else → unpooled (still added to ANIMATIONS, just not auto-played)

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const LOADER = path.join(ROOT, "frontend", "src", "lib", "bvhLoader.ts");
const MANIFEST = path.join(__dirname, "mixamo-manifest.json");

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const clips = (manifest.results || []).filter((r) => !r.error && r.file);

function classify(name) {
  const n = name.toLowerCase();
  if (/(dance|dancing|twerk|salsa|tango|hip_hop|bellydanc|booty|rumba|hiphop)/.test(n)) return "dance";
  if (/(walk|catwalk|run|jog|stride|march|stroll)/.test(n)) return "walk";
  if (/(happy|laugh|joy|excited|cheer)/.test(n)) return "happy";
  if (/(sad|cry|grief|sorrow|mourn|disappoint)/.test(n)) return "sad";
  if (/(angry|anger|annoy|rage|fury)/.test(n)) return "sad"; // routes into sad pool until we add a separate angry pool
  if (/(wave|greet|salute|hello|bow)/.test(n)) return "greeting";
  if (/(idle|breath|standing)/.test(n)) return "idle";
  if (/(fall|die|hurt|stumble|trip|knock)/.test(n)) return "energetic";
  if (/(peek|aim|focus|shoot|sneak|hide|alert)/.test(n)) return "thinking";
  return "unpooled";
}

const POOL_NAMES = {
  dance: "DANCE_VARIANTS",
  walk: "WALK_VARIANTS",
  happy: "HAPPY_VARIANTS",
  sad: "SAD_VARIANTS",
  greeting: "GREETING_VARIANTS",
  idle: "IDLE_VARIANTS",
  energetic: "ENERGETIC_VARIANTS",
  thinking: "THINKING_VARIANTS",
};

const byPool = {};
for (const c of clips) {
  c.classification = classify(c.name);
  if (c.classification === "unpooled") continue;
  if (!byPool[c.classification]) byPool[c.classification] = [];
  byPool[c.classification].push(c);
}

console.log(`Classifying ${clips.length} converted Mixamo clips:`);
for (const [cls, list] of Object.entries(byPool)) {
  console.log(`  ${cls.padEnd(12)} ${list.length}`);
}
console.log(`  unpooled     ${clips.filter((c) => c.classification === "unpooled").length}`);
console.log();

let src = fs.readFileSync(LOADER, "utf8");

// Inject ANIMATIONS entries before the closing `} as const;`
const animationEntries = clips
  .map((c) => `  ${c.name}: "${c.file}",`)
  .join("\n");
const marker = `} as const;`;
const injection = `\n\n  // ═══════ Mixamo pack (converted by scripts/convert-mixamo-pack.cjs) ═══════\n  // ${clips.length} clips. License: Mixamo content (Adobe). See CREDITS.md.\n${animationEntries}\n${marker}`;
src = src.replace(marker, injection);

// Append to each variant array
function addToArray(arrName, items) {
  if (items.length === 0) return;
  const re = new RegExp(`export const ${arrName}: AnimationName\\[\\] = \\[([\\s\\S]*?)\\];`);
  src = src.replace(re, (_, inner) => {
    const trimmed = inner.replace(/\s+$/, "");
    const additions = items.map((c) => `  "${c.name}",`).join("\n");
    return `export const ${arrName}: AnimationName[] = [${trimmed}\n  // ── Mixamo pack ──\n${additions}\n];`;
  });
}
for (const [cls, list] of Object.entries(byPool)) {
  const arrName = POOL_NAMES[cls];
  if (arrName) addToArray(arrName, list);
}

fs.writeFileSync(LOADER, src);
console.log(`Updated ${LOADER}`);

// Update CREDITS.md
const creditsFile = path.join(ROOT, "frontend", "public", "animations", "CREDITS.md");
let credits = fs.readFileSync(creditsFile, "utf8");
const stamp = new Date().toISOString().slice(0, 10);
const mixamoSection = `

## Mixamo pack (added ${stamp})

${clips.length} clips converted from Mixamo FBX exports via Blender headless (\`scripts/convert-mixamo-pack.cjs\` + \`scripts/fbx-to-bvh.py\`).

**License:** Mixamo (Adobe) content. Per Mixamo's terms, animations may be incorporated into commercial works when downloaded via an Adobe account. License does not permit redistribution as standalone files — DSOS bundles them inside the application, which is the permitted use.

### Classification breakdown
${Object.entries(byPool).map(([cls, list]) => `- **${cls}**: ${list.length}`).join("\n")}
- **unpooled**: ${clips.filter((c) => c.classification === "unpooled").length} (catalogued but not in auto-rotation pools)

### Clip list
${clips.map((c) => `- \`${c.file}\` — ${c.classification} — from \`${c.src}\``).join("\n")}
`;
if (!credits.includes("Mixamo pack (added")) {
  credits += mixamoSection;
  fs.writeFileSync(creditsFile, credits);
  console.log(`Appended Mixamo section to ${creditsFile}`);
}
