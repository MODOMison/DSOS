// BVH loader + bone retargeter for VRM rigs.
//
// The Mixamo-sourced BVH library we ship uses camelCase bone names that
// match VRM's humanoid naming almost 1:1 (just lowercase: "hips" vs "Hips").
// Three.js BVHLoader produces an AnimationClip with tracks targeting bones
// by name. We rewrite each track to target the actual scene-object name
// of the corresponding VRM normalized bone.
//
// Position tracks on Hips are stripped — for a stationary desktop avatar
// we don't want her wandering off-screen during a dance.

import * as THREE from "three";
import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader.js";
import {
  VRM,
  VRMHumanBoneName,
} from "@pixiv/three-vrm";

// Mapping from BVH bone names (Mixamo-style camelCase as used in the
// Silly-Tavern VRM Assets Pack) to VRM humanoid bone enum values.
const BVH_TO_VRM: Record<string, VRMHumanBoneName> = {
  // Core
  hips: VRMHumanBoneName.Hips,
  spine: VRMHumanBoneName.Spine,
  chest: VRMHumanBoneName.Chest,
  upperChest: VRMHumanBoneName.UpperChest,
  neck: VRMHumanBoneName.Neck,
  head: VRMHumanBoneName.Head,
  leftEye: VRMHumanBoneName.LeftEye,
  rightEye: VRMHumanBoneName.RightEye,
  // Arms
  leftShoulder: VRMHumanBoneName.LeftShoulder,
  leftUpperArm: VRMHumanBoneName.LeftUpperArm,
  leftLowerArm: VRMHumanBoneName.LeftLowerArm,
  leftHand: VRMHumanBoneName.LeftHand,
  rightShoulder: VRMHumanBoneName.RightShoulder,
  rightUpperArm: VRMHumanBoneName.RightUpperArm,
  rightLowerArm: VRMHumanBoneName.RightLowerArm,
  rightHand: VRMHumanBoneName.RightHand,
  // Legs
  leftUpperLeg: VRMHumanBoneName.LeftUpperLeg,
  leftLowerLeg: VRMHumanBoneName.LeftLowerLeg,
  leftFoot: VRMHumanBoneName.LeftFoot,
  leftToes: VRMHumanBoneName.LeftToes,
  rightUpperLeg: VRMHumanBoneName.RightUpperLeg,
  rightLowerLeg: VRMHumanBoneName.RightLowerLeg,
  rightFoot: VRMHumanBoneName.RightFoot,
  rightToes: VRMHumanBoneName.RightToes,
  // Left fingers (BVH proximal/intermediate/distal → VRM metacarpal/proximal/distal for thumb,
  // proximal/intermediate/distal for the others).
  leftThumbProximal: VRMHumanBoneName.LeftThumbMetacarpal,
  leftThumbIntermediate: VRMHumanBoneName.LeftThumbProximal,
  leftThumbDistal: VRMHumanBoneName.LeftThumbDistal,
  leftIndexProximal: VRMHumanBoneName.LeftIndexProximal,
  leftIndexIntermediate: VRMHumanBoneName.LeftIndexIntermediate,
  leftIndexDistal: VRMHumanBoneName.LeftIndexDistal,
  leftMiddleProximal: VRMHumanBoneName.LeftMiddleProximal,
  leftMiddleIntermediate: VRMHumanBoneName.LeftMiddleIntermediate,
  leftMiddleDistal: VRMHumanBoneName.LeftMiddleDistal,
  leftRingProximal: VRMHumanBoneName.LeftRingProximal,
  leftRingIntermediate: VRMHumanBoneName.LeftRingIntermediate,
  leftRingDistal: VRMHumanBoneName.LeftRingDistal,
  leftLittleProximal: VRMHumanBoneName.LeftLittleProximal,
  leftLittleIntermediate: VRMHumanBoneName.LeftLittleIntermediate,
  leftLittleDistal: VRMHumanBoneName.LeftLittleDistal,
  // Right fingers
  rightThumbProximal: VRMHumanBoneName.RightThumbMetacarpal,
  rightThumbIntermediate: VRMHumanBoneName.RightThumbProximal,
  rightThumbDistal: VRMHumanBoneName.RightThumbDistal,
  rightIndexProximal: VRMHumanBoneName.RightIndexProximal,
  rightIndexIntermediate: VRMHumanBoneName.RightIndexIntermediate,
  rightIndexDistal: VRMHumanBoneName.RightIndexDistal,
  rightMiddleProximal: VRMHumanBoneName.RightMiddleProximal,
  rightMiddleIntermediate: VRMHumanBoneName.RightMiddleIntermediate,
  rightMiddleDistal: VRMHumanBoneName.RightMiddleDistal,
  rightRingProximal: VRMHumanBoneName.RightRingProximal,
  rightRingIntermediate: VRMHumanBoneName.RightRingIntermediate,
  rightRingDistal: VRMHumanBoneName.RightRingDistal,
  rightLittleProximal: VRMHumanBoneName.RightLittleProximal,
  rightLittleIntermediate: VRMHumanBoneName.RightLittleIntermediate,
  rightLittleDistal: VRMHumanBoneName.RightLittleDistal,
};

// Retarget a BVH-loaded clip onto a specific VRM instance. Tracks for
// bones the VRM doesn't have are silently dropped.
function retargetClip(clip: THREE.AnimationClip, vrm: VRM): THREE.AnimationClip {
  const newTracks: THREE.KeyframeTrack[] = [];

  for (const track of clip.tracks) {
    const dotIdx = track.name.indexOf(".");
    if (dotIdx === -1) continue;
    const bvhBoneName = track.name.slice(0, dotIdx);
    const prop = track.name.slice(dotIdx + 1); // "quaternion" | "position" | "scale"

    // Strip Hips position — keeps her grounded instead of wandering during dance/walk.
    if (prop !== "quaternion") continue;

    const vrmBoneType = BVH_TO_VRM[bvhBoneName];
    if (!vrmBoneType) continue;

    const vrmBone = vrm.humanoid?.getNormalizedBoneNode(vrmBoneType);
    if (!vrmBone) continue;

    const Cls = track.constructor as {
      new (
        name: string,
        times: ArrayLike<number>,
        values: ArrayLike<number>
      ): THREE.KeyframeTrack;
    };
    newTracks.push(new Cls(`${vrmBone.name}.${prop}`, track.times, track.values));
  }

  return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
}

// In-memory cache keyed by URL. BVH parsing is expensive enough that
// reloading the same file twice is silly.
const clipCache: Map<string, Promise<THREE.AnimationClip>> = new Map();

export async function loadBvhClip(
  url: string,
  vrm: VRM
): Promise<THREE.AnimationClip> {
  // We can cache the raw clip but retargeted clips are per-VRM. Since we
  // currently only have one VRM in DSOS this is fine — cache by URL.
  const cached = clipCache.get(url);
  if (cached) return cached;

  const loader = new BVHLoader();
  const promise = new Promise<THREE.AnimationClip>((resolve, reject) => {
    loader.load(
      url,
      (result) => {
        try {
          const retargeted = retargetClip(result.clip, vrm);
          resolve(retargeted);
        } catch (e) {
          reject(e);
        }
      },
      undefined,
      (err) => reject(err)
    );
  });
  clipCache.set(url, promise);
  // If the promise rejects, evict so a retry can rebuild it.
  promise.catch(() => clipCache.delete(url));
  return promise;
}

// Catalog of available clips. Keys are the friendly names we expose to the
// rest of the app; values are the BVH filename under /animations/.
export const ANIMATIONS = {
  // Looping idles
  neutral_idle: "neutral_idle.bvh",
  neutral_idle2: "neutral_idle2.bvh",
  sit_idle: "sit_idle.bvh",
  sit_idle2: "sit_idle2.bvh",
  kneel_idle: "kneel_idle.bvh",
  laying_idle: "laying_idle.bvh",

  // Emotion (one-shots)
  joy: "joy.bvh",
  joy2: "joy2.bvh",
  joy3: "joy3.bvh",
  sadness: "sadness.bvh",
  sadness2: "sadness2.bvh",
  anger: "anger.bvh",
  surprise: "surprise.bvh",
  curiosity: "curiosity.bvh",
  confusion: "confusion.bvh",
  approval: "approval.bvh",
  approval2: "approval2.bvh",
  disapproval: "disapproval.bvh",
  embarrassment: "embarrassment.bvh",
  excitement: "excitement.bvh",
  excitement2: "excitement2.bvh",
  fear: "fear.bvh",
  realization: "realization.bvh",
  relief: "relief.bvh",
  pride: "pride.bvh",
  amusement: "amusement.bvh",
  amusement2: "amusement2.bvh",
  amusement3: "amusement3.bvh",
  caring: "caring.bvh",
  neutral: "neutral.bvh",
  gratitude: "gratitude.bvh",
  optimism: "optimism.bvh",
  admiration: "admiration.bvh",
  nervousness: "nervousness.bvh",
  remorse: "remorse.bvh",
  disappointment: "disappointment.bvh",
  annoyance: "annoyance.bvh",

  // Actions (one-shots)
  greeting: "action_greeting.bvh",
  greeting2: "action_greeting1.bvh",
  walk: "action_walk.bvh",
  run: "action_run.bvh",
  jog: "action_jog.bvh",
  jump: "action_jump.bvh",
  standup: "action_standup.bvh",
  crouch: "action_crouch.bvh",
  pickingup: "action_pickingup.bvh",
  pat: "action_pat.bvh",
  gaming: "action_gaming.bvh",
  laydown: "action_laydown.bvh",
  attention_seeking: "action_attention_seeking.bvh",

  // Dances
  dance_1: "dance_1.bvh",
  dance_2: "dance_2.bvh",
  dance_dab: "dance_dab.bvh",
  dance_gangnam: "dance_gangnam_style.bvh",
  dance_rumba: "dance_rumba.bvh",
  dance_headdrop: "dance_headdrop.bvh",
  dance_marachinostep: "dance_marachinostep.bvh",
  dance_northern_soul_spin: "dance_northern_soul_spin.bvh",
  dance_ontop: "dance_ontop.bvh",
  dance_pushback: "dance_pushback.bvh",
  dance_backup: "dance_backup.bvh",

  // CMU life (eating, drinking, domestic)

  // CMU female-subject general (broad coverage from CMU subject #106)


  // ═══════ Mixamo pack (converted by scripts/convert-mixamo-pack.cjs) ═══════
  // 65 clips. License: Mixamo content (Adobe). See CREDITS.md.
  mixamo_angry: "mixamo_angry.bvh",
  mixamo_arms_hip_hop_dance: "mixamo_arms_hip_hop_dance.bvh",
  mixamo_bellydancing: "mixamo_bellydancing.bvh",
  mixamo_booty_hip_hop_dance: "mixamo_booty_hip_hop_dance.bvh",
  mixamo_catwalk_walk_forward_highknees: "mixamo_catwalk_walk_forward_highknees.bvh",
  mixamo_catwalk_walk_start_backwards_180l: "mixamo_catwalk_walk_start_backwards_180l.bvh",
  mixamo_catwalk_walk: "mixamo_catwalk_walk.bvh",
  mixamo_crazy_gesture: "mixamo_crazy_gesture.bvh",
  mixamo_crying: "mixamo_crying.bvh",
  mixamo_dancing_1: "mixamo_dancing_1.bvh",
  mixamo_dancing: "mixamo_dancing.bvh",
  mixamo_excited: "mixamo_excited.bvh",
  mixamo_falling: "mixamo_falling.bvh",
  mixamo_female_peek_and_aim: "mixamo_female_peek_and_aim.bvh",
  mixamo_femme_peek_around_corner: "mixamo_femme_peek_around_corner.bvh",
  mixamo_focus: "mixamo_focus.bvh",
  mixamo_happy: "mixamo_happy.bvh",
  mixamo_hip_hop_dancing_1: "mixamo_hip_hop_dancing_1.bvh",
  mixamo_hip_hop_dancing_2: "mixamo_hip_hop_dancing_2.bvh",
  mixamo_hip_hop_dancing_3: "mixamo_hip_hop_dancing_3.bvh",
  mixamo_hip_hop_dancing_4: "mixamo_hip_hop_dancing_4.bvh",
  mixamo_hip_hop_dancing_5: "mixamo_hip_hop_dancing_5.bvh",
  mixamo_hip_hop_dancing_6: "mixamo_hip_hop_dancing_6.bvh",
  mixamo_hip_hop_dancing_7: "mixamo_hip_hop_dancing_7.bvh",
  mixamo_hip_hop_dancing_8: "mixamo_hip_hop_dancing_8.bvh",
  mixamo_hip_hop_dancing: "mixamo_hip_hop_dancing.bvh",
  mixamo_idle: "mixamo_idle.bvh",
  mixamo_jazz_dancing: "mixamo_jazz_dancing.bvh",
  mixamo_leaning_on_a_wall: "mixamo_leaning_on_a_wall.bvh",
  mixamo_left_turn: "mixamo_left_turn.bvh",
  mixamo_macarena_dance: "mixamo_macarena_dance.bvh",
  mixamo_ninja_idle_1: "mixamo_ninja_idle_1.bvh",
  mixamo_ninja_idle: "mixamo_ninja_idle.bvh",
  mixamo_pacing_and_talking_on_a_phone: "mixamo_pacing_and_talking_on_a_phone.bvh",
  mixamo_plotting: "mixamo_plotting.bvh",
  mixamo_rejected: "mixamo_rejected.bvh",
  mixamo_right_turn: "mixamo_right_turn.bvh",
  mixamo_rumba_dancing: "mixamo_rumba_dancing.bvh",
  mixamo_run: "mixamo_run.bvh",
  mixamo_salsa_dancing: "mixamo_salsa_dancing.bvh",
  mixamo_samba_dancing_1: "mixamo_samba_dancing_1.bvh",
  mixamo_samba_dancing_2: "mixamo_samba_dancing_2.bvh",
  mixamo_samba_dancing_3: "mixamo_samba_dancing_3.bvh",
  mixamo_samba_dancing: "mixamo_samba_dancing.bvh",
  mixamo_snake_hip_hop_dance: "mixamo_snake_hip_hop_dance.bvh",
  mixamo_standing_greeting: "mixamo_standing_greeting.bvh",
  mixamo_step_hip_hop_dance: "mixamo_step_hip_hop_dance.bvh",
  mixamo_talking_1: "mixamo_talking_1.bvh",
  mixamo_talking_on_phone: "mixamo_talking_on_phone.bvh",
  mixamo_talking: "mixamo_talking.bvh",
  mixamo_taunt: "mixamo_taunt.bvh",
  mixamo_texting_and_walking: "mixamo_texting_and_walking.bvh",
  mixamo_thankful: "mixamo_thankful.bvh",
  mixamo_threatening: "mixamo_threatening.bvh",
  mixamo_twist_dance: "mixamo_twist_dance.bvh",
  mixamo_walk_in_circle: "mixamo_walk_in_circle.bvh",
  mixamo_gangnam_style: "mixamo_gangnam_style.bvh",
  mixamo_jump: "mixamo_jump.bvh",
  mixamo_left_strafe_walking: "mixamo_left_strafe_walking.bvh",
  mixamo_left_turn_90: "mixamo_left_turn_90.bvh",
  mixamo_right_strafe_walking: "mixamo_right_strafe_walking.bvh",
  mixamo_right_turn_90: "mixamo_right_turn_90.bvh",
  mixamo_walking: "mixamo_walking.bvh",
} as const;

export type AnimationName = keyof typeof ANIMATIONS;

export function animationUrl(name: AnimationName): string {
  return `/animations/${ANIMATIONS[name]}`;
}

// Curated random-pick helpers. CMU clips are weighted alongside the
// originals so Oracle has the wide expressive range a real person does —
// most chats land on the common moves, but the rare/long clips still play.

export const HAPPY_VARIANTS: AnimationName[] = [
  "joy", "joy2", "joy3",
  "approval", "approval2",
  "amusement", "amusement2",
  "excitement",
  // ── Mixamo pack ──
  "mixamo_excited",
  "mixamo_happy",
  "mixamo_thankful",
];

export const SAD_VARIANTS: AnimationName[] = [
  "sadness", "sadness2",
  "disappointment",
  // ── Mixamo pack ──
  "mixamo_angry",
  "mixamo_crying",
  "mixamo_rejected",
];

export const THINKING_VARIANTS: AnimationName[] = [
  "curiosity", "confusion",
  // ── Mixamo pack ──
  "mixamo_female_peek_and_aim",
  "mixamo_femme_peek_around_corner",
  "mixamo_focus",
  "mixamo_plotting",
];

// Standard dances — high-rotation, played when Oracle gets bored.
export const DANCE_VARIANTS: AnimationName[] = [
  "dance_1", "dance_2",
  "dance_dab", "dance_gangnam", "dance_rumba",
  "dance_headdrop", "dance_marachinostep", "dance_northern_soul_spin",
  "dance_pushback", "dance_backup",
  // ── Mixamo pack ──
  "mixamo_arms_hip_hop_dance",
  "mixamo_bellydancing",
  "mixamo_booty_hip_hop_dance",
  "mixamo_dancing_1",
  "mixamo_dancing",
  "mixamo_gangnam_style",
  "mixamo_hip_hop_dancing_1",
  "mixamo_hip_hop_dancing_2",
  "mixamo_hip_hop_dancing_3",
  "mixamo_hip_hop_dancing_4",
  "mixamo_hip_hop_dancing_5",
  "mixamo_hip_hop_dancing_6",
  "mixamo_hip_hop_dancing_7",
  "mixamo_hip_hop_dancing_8",
  "mixamo_hip_hop_dancing",
  "mixamo_jazz_dancing",
  "mixamo_macarena_dance",
  "mixamo_rumba_dancing",
  "mixamo_salsa_dancing",
  "mixamo_samba_dancing_1",
  "mixamo_samba_dancing_2",
  "mixamo_samba_dancing_3",
  "mixamo_samba_dancing",
  "mixamo_snake_hip_hop_dance",
  "mixamo_step_hip_hop_dance",
  "mixamo_twist_dance",
];

// Rare/showy moves — gated to occasional plays so they stay special.
export const RARE_DANCE_VARIANTS: AnimationName[] = [
];

// Looping idles when Oracle is just hanging out.
export const IDLE_VARIANTS: AnimationName[] = [
  "neutral_idle", "neutral_idle2",
  // ── Mixamo pack ──
  "mixamo_idle",
  "mixamo_ninja_idle_1",
  "mixamo_ninja_idle",
  "mixamo_leaning_on_a_wall",
];

// Background "life" clips — eating, working, playing instruments. Played
// occasionally during very long idle periods to feel like she has a life.
export const LIFE_VARIANTS: AnimationName[] = [
  // ── Mixamo pack ──
  "mixamo_talking",
  "mixamo_talking_1",
  "mixamo_talking_on_phone",
  "mixamo_pacing_and_talking_on_a_phone",
];

// Communicative one-shots — wave hello, point, shake hands.
export const GREETING_VARIANTS: AnimationName[] = [
  "greeting", "greeting2",
  // ── Mixamo pack ──
  "mixamo_standing_greeting",
];

// Energetic action moves — for "excited" / surprised moments.
export const ENERGETIC_VARIANTS: AnimationName[] = [
  // ── Mixamo pack ──
  "mixamo_falling",
  "mixamo_jump",
  "mixamo_taunt",
  "mixamo_threatening",
  "mixamo_crazy_gesture",
];

// Walking variants — emotional and otherwise.
export const WALK_VARIANTS: AnimationName[] = [
  "walk", "run", "jog",
  // ── Mixamo pack ──
  "mixamo_catwalk_walk_forward_highknees",
  "mixamo_catwalk_walk_start_backwards_180l",
  "mixamo_catwalk_walk",
  "mixamo_run",
  "mixamo_texting_and_walking",
  "mixamo_walk_in_circle",
  "mixamo_left_strafe_walking",
  "mixamo_right_strafe_walking",
  "mixamo_walking",
  "mixamo_left_turn",
  "mixamo_right_turn",
  "mixamo_left_turn_90",
  "mixamo_right_turn_90",
];

export function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Weighted random pick across multiple pools. Used so the long-tail "life"
 * and "rare dance" clips play occasionally without dominating the rotation.
 *
 * Example: weightedPick([[DANCE_VARIANTS, 70], [RARE_DANCE_VARIANTS, 10], [LIFE_VARIANTS, 20]])
 */
export function weightedPick(
  pools: [readonly AnimationName[], number][]
): AnimationName {
  const total = pools.reduce((a, [, w]) => a + w, 0);
  let roll = Math.random() * total;
  for (const [pool, weight] of pools) {
    roll -= weight;
    if (roll <= 0) return randomFrom(pool);
  }
  return randomFrom(pools[0][0]);
}
