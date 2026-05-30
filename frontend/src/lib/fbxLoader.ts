// Mixamo FBX → VRM animation retargeter.
//
// Naive track copy doesn't work because Mixamo bones and VRM bones have
// different rest-pose orientations. Same quaternion → different visual
// rotation on each rig, hence the crumpled body. Fix is the canonical
// pattern from the pixiv three-vrm examples: for each keyframe, pre-multiply
// by the parent's world rest rotation and right-multiply by the inverse of
// the bone's own world rest rotation. That converts a Mixamo-local rotation
// into a VRM-local rotation accounting for rest-pose differences.
//
// For VRM 0.x avatars (forward = -Z), also negate the x/z components of
// each quaternion to compensate for the inverted root orientation.

import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

// Mixamo rig node name → VRM humanoid bone. Mixamo FBX exports typically
// use the "mixamorig" prefix concatenated to the bone name (no colon, no
// underscore) in the Object3D name field that three.js sees.
const MIXAMO_TO_VRM: Record<string, VRMHumanBoneName> = {
  mixamorigHips: VRMHumanBoneName.Hips,
  mixamorigSpine: VRMHumanBoneName.Spine,
  mixamorigSpine1: VRMHumanBoneName.Chest,
  mixamorigSpine2: VRMHumanBoneName.UpperChest,
  mixamorigNeck: VRMHumanBoneName.Neck,
  mixamorigHead: VRMHumanBoneName.Head,
  mixamorigLeftShoulder: VRMHumanBoneName.LeftShoulder,
  mixamorigLeftArm: VRMHumanBoneName.LeftUpperArm,
  mixamorigLeftForeArm: VRMHumanBoneName.LeftLowerArm,
  mixamorigLeftHand: VRMHumanBoneName.LeftHand,
  mixamorigRightShoulder: VRMHumanBoneName.RightShoulder,
  mixamorigRightArm: VRMHumanBoneName.RightUpperArm,
  mixamorigRightForeArm: VRMHumanBoneName.RightLowerArm,
  mixamorigRightHand: VRMHumanBoneName.RightHand,
  mixamorigLeftUpLeg: VRMHumanBoneName.LeftUpperLeg,
  mixamorigLeftLeg: VRMHumanBoneName.LeftLowerLeg,
  mixamorigLeftFoot: VRMHumanBoneName.LeftFoot,
  mixamorigLeftToeBase: VRMHumanBoneName.LeftToes,
  mixamorigRightUpLeg: VRMHumanBoneName.RightUpperLeg,
  mixamorigRightLeg: VRMHumanBoneName.RightLowerLeg,
  mixamorigRightFoot: VRMHumanBoneName.RightFoot,
  mixamorigRightToeBase: VRMHumanBoneName.RightToes,
  mixamorigLeftHandThumb1: VRMHumanBoneName.LeftThumbMetacarpal,
  mixamorigLeftHandThumb2: VRMHumanBoneName.LeftThumbProximal,
  mixamorigLeftHandThumb3: VRMHumanBoneName.LeftThumbDistal,
  mixamorigLeftHandIndex1: VRMHumanBoneName.LeftIndexProximal,
  mixamorigLeftHandIndex2: VRMHumanBoneName.LeftIndexIntermediate,
  mixamorigLeftHandIndex3: VRMHumanBoneName.LeftIndexDistal,
  mixamorigLeftHandMiddle1: VRMHumanBoneName.LeftMiddleProximal,
  mixamorigLeftHandMiddle2: VRMHumanBoneName.LeftMiddleIntermediate,
  mixamorigLeftHandMiddle3: VRMHumanBoneName.LeftMiddleDistal,
  mixamorigLeftHandRing1: VRMHumanBoneName.LeftRingProximal,
  mixamorigLeftHandRing2: VRMHumanBoneName.LeftRingIntermediate,
  mixamorigLeftHandRing3: VRMHumanBoneName.LeftRingDistal,
  mixamorigLeftHandPinky1: VRMHumanBoneName.LeftLittleProximal,
  mixamorigLeftHandPinky2: VRMHumanBoneName.LeftLittleIntermediate,
  mixamorigLeftHandPinky3: VRMHumanBoneName.LeftLittleDistal,
  mixamorigRightHandThumb1: VRMHumanBoneName.RightThumbMetacarpal,
  mixamorigRightHandThumb2: VRMHumanBoneName.RightThumbProximal,
  mixamorigRightHandThumb3: VRMHumanBoneName.RightThumbDistal,
  mixamorigRightHandIndex1: VRMHumanBoneName.RightIndexProximal,
  mixamorigRightHandIndex2: VRMHumanBoneName.RightIndexIntermediate,
  mixamorigRightHandIndex3: VRMHumanBoneName.RightIndexDistal,
  mixamorigRightHandMiddle1: VRMHumanBoneName.RightMiddleProximal,
  mixamorigRightHandMiddle2: VRMHumanBoneName.RightMiddleIntermediate,
  mixamorigRightHandMiddle3: VRMHumanBoneName.RightMiddleDistal,
  mixamorigRightHandRing1: VRMHumanBoneName.RightRingProximal,
  mixamorigRightHandRing2: VRMHumanBoneName.RightRingIntermediate,
  mixamorigRightHandRing3: VRMHumanBoneName.RightRingDistal,
  mixamorigRightHandPinky1: VRMHumanBoneName.RightLittleProximal,
  mixamorigRightHandPinky2: VRMHumanBoneName.RightLittleIntermediate,
  mixamorigRightHandPinky3: VRMHumanBoneName.RightLittleDistal,
};

function retargetMixamoClip(
  asset: THREE.Group,
  clip: THREE.AnimationClip,
  vrm: VRM
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];

  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _q = new THREE.Quaternion();

  // VRM 0.x has its forward axis on -Z, so quaternion x and z must be
  // negated when retargeting from Mixamo's +Z forward orientation.
  // VRM 1.0 matches Mixamo's +Z, no flip needed.
  const isVrm0 = vrm.meta?.metaVersion === "0";

  for (const track of clip.tracks) {
    const dotIdx = track.name.lastIndexOf(".");
    if (dotIdx === -1) continue;
    const mixamoRigName = track.name.slice(0, dotIdx);
    const prop = track.name.slice(dotIdx + 1);
    if (prop !== "quaternion") continue; // strip positions/scales

    const vrmBoneType = MIXAMO_TO_VRM[mixamoRigName];
    if (!vrmBoneType) continue;
    const vrmNode = vrm.humanoid?.getNormalizedBoneNode(vrmBoneType);
    if (!vrmNode) continue;
    const mixamoNode = asset.getObjectByName(mixamoRigName);
    if (!mixamoNode || !mixamoNode.parent) continue;

    // Capture rest-pose orientations in world space.
    mixamoNode.getWorldQuaternion(restRotationInverse).invert();
    mixamoNode.parent.getWorldQuaternion(parentRestWorldRotation);

    if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;

    // Rewrite each keyframe quaternion into VRM's local frame.
    const values = new Float32Array(track.values.length);
    for (let i = 0; i < track.values.length; i += 4) {
      _q.fromArray(track.values, i);
      _q.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
      _q.toArray(values, i);
      if (isVrm0) {
        values[i + 0] = -values[i + 0]; // x
        values[i + 2] = -values[i + 2]; // z
      }
    }

    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${vrmNode.name}.${prop}`,
        track.times,
        values
      )
    );
  }

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

const fbxClipCache: Map<string, Promise<THREE.AnimationClip>> = new Map();

export async function loadFbxClip(
  url: string,
  vrm: VRM
): Promise<THREE.AnimationClip> {
  const cached = fbxClipCache.get(url);
  if (cached) return cached;
  const loader = new FBXLoader();
  const promise = new Promise<THREE.AnimationClip>((resolve, reject) => {
    loader.load(
      url,
      (asset) => {
        try {
          if (!asset.animations || asset.animations.length === 0) {
            reject(new Error(`No animation tracks in FBX: ${url}`));
            return;
          }
          // Mixamo FBX ships a single clip, usually named "mixamo.com".
          const clip = asset.animations[0];
          resolve(retargetMixamoClip(asset, clip, vrm));
        } catch (e) {
          reject(e);
        }
      },
      undefined,
      (err) => reject(err)
    );
  });
  fbxClipCache.set(url, promise);
  promise.catch(() => fbxClipCache.delete(url));
  return promise;
}
