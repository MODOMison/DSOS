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
  // ═══════ Male (Mixamo FBX) — Matt's Shadow rig ═══════
  // Idles
  male_idle: "Standing Idle 03.fbx",
  male_idle_alt: "Idle.fbx",
  male_idle_2: "Idle (1).fbx",
  male_idle_bouncing: "Bouncing Fight Idle.fbx",
  // Reactions / gestures
  male_agreeing: "Agreeing.fbx",
  male_dismissing: "Dismissing Gesture.fbx",
  male_dismissing_2: "Dismissing Gesture (1).fbx",
  male_pointing: "Pointing.fbx",
  male_surprised: "Surprised.fbx",
  male_thoughtful_shake: "Thoughtful Head Shake.fbx",
  male_look_over_shoulder: "Look Over Shoulder.fbx",
  male_telling_secret: "Telling A Secret.fbx",
  // Greetings / formal
  male_entry: "Entry.fbx",
  male_salute: "Salute.fbx",
  male_salute_2: "Salute (1).fbx",
  // Work / thinking
  male_searching_files: "Searching Files High.fbx",
  male_button_pushing: "Button Pushing.fbx",
  male_praying: "Praying.fbx",
  male_praying_2: "Praying (1).fbx",
  // Walks
  male_walking: "Walking.fbx",
  male_running: "Running.fbx",
  male_walk_start: "Start Walking.fbx",
  male_walk_start_2: "Start Walking (1).fbx",
  male_walk_strut: "Strut Walking.fbx",
  male_walk_strut_2: "Strut Walking (1).fbx",
  male_walk_catwalk: "Catwalk Idle To Walk Forward.fbx",
  male_side_step: "Short Left Side Step.fbx",
  male_stand_to_cover: "Stand To Cover.fbx",
  // Dances
  male_dance_hiphop: "Hip Hop Dancing.fbx",
  male_dance_hiphop_2: "Hip Hop Dancing (1).fbx",
  male_dance_silly: "Silly Dancing.fbx",
  // Life / hobbies
  male_guitar: "Guitar Playing.fbx",
  male_cards: "Cards.fbx",
  male_texting: "Texting While Standing.fbx",
  male_fishing: "Fishing Cast.fbx",
  male_punching_bag: "Punching Bag.fbx",
  male_shooting_arrow: "Shooting Arrow.fbx",
  male_rifle: "Grab Rifle And Put Back.fbx",
  male_door_open: "Opening Door Inwards.fbx",
  male_door_open_2: "Opening Door Inwards (1).fbx",
} as const;

export type AnimationName = keyof typeof ANIMATIONS;

export function animationUrl(name: AnimationName): string {
  // Encode the filename so spaces, parens, and other special chars don't
  // break the fetch (Mixamo FBX downloads frequently include "(1)" etc).
  return `/animations/${encodeURIComponent(ANIMATIONS[name])}`;
}

// Curated random-pick helpers. CMU clips are weighted alongside the
// originals so Shadows has the wide expressive range a real person does —
// most chats land on the common moves, but the rare/long clips still play.

export const HAPPY_VARIANTS: AnimationName[] = [
  "male_agreeing",
  "male_pointing",
  "male_entry",
  "male_salute",
];

export const SAD_VARIANTS: AnimationName[] = [
  "male_dismissing",
  "male_dismissing_2",
  "male_thoughtful_shake",
  "male_praying",
  "male_look_over_shoulder",
];

export const THINKING_VARIANTS: AnimationName[] = [
  "male_searching_files",
  "male_button_pushing",
  "male_thoughtful_shake",
  "male_telling_secret",
];

// Standard dances — high-rotation, played when Shadows gets bored.
export const DANCE_VARIANTS: AnimationName[] = [
  "male_dance_hiphop",
  "male_dance_hiphop_2",
  "male_dance_silly",
];

// Rare/showy moves — gated to occasional plays so they stay special.
export const RARE_DANCE_VARIANTS: AnimationName[] = [];

// Looping idles when Shadows is just hanging out.
export const IDLE_VARIANTS: AnimationName[] = [
  "male_idle",
  "male_idle_alt",
  "male_idle_2",
  "male_idle_bouncing",
];

// Background "life" clips — hobbies, work, in-character moments. Played
// occasionally during very long idle periods so Shadow feels like he has
// things going on.
export const LIFE_VARIANTS: AnimationName[] = [
  "male_guitar",
  "male_cards",
  "male_texting",
  "male_fishing",
  "male_punching_bag",
  "male_shooting_arrow",
  "male_rifle",
  "male_door_open",
  "male_door_open_2",
  "male_stand_to_cover",
];

// Communicative one-shots — wave hello, salute, gesture at the user.
export const GREETING_VARIANTS: AnimationName[] = [
  "male_entry",
  "male_salute",
  "male_salute_2",
  "male_pointing",
];

// Energetic action moves — for "excited" / surprised moments.
export const ENERGETIC_VARIANTS: AnimationName[] = [
  "male_surprised",
  "male_punching_bag",
];

// Walking variants — for future use (no current code path triggers walks).
export const WALK_VARIANTS: AnimationName[] = [
  "male_walking",
  "male_running",
  "male_walk_start",
  "male_walk_start_2",
  "male_walk_strut",
  "male_walk_strut_2",
  "male_walk_catwalk",
  "male_side_step",
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
