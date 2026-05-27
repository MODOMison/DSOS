"""
fbx-to-bvh.py — Blender headless script.
Run with: blender --background --python fbx-to-bvh.py -- INPUT.fbx OUTPUT.bvh

What it does:
  1. Clears Blender's scene
  2. Imports the FBX (Mixamo-style armature)
  3. Renames bones from "mixamorig:Hips" → "hips" (Mixamo camelCase)
     so DSOS's bvhLoader's BVH_TO_VRM map can retarget them onto the VRM rig
  4. Exports as BVH, scaled appropriately for the VRM character size

Output BVH bone names match what bvhLoader.ts expects.
"""

import bpy
import sys

# Mixamo (PascalCase, "mixamorig:" prefix) → DSOS camelCase
BONE_RENAME = {
    "mixamorig:Hips": "hips",
    "mixamorig:Spine": "spine",
    "mixamorig:Spine1": "chest",
    "mixamorig:Spine2": "upperChest",
    "mixamorig:Neck": "neck",
    "mixamorig:Head": "head",
    "mixamorig:HeadTop_End": "headEnd",
    "mixamorig:LeftEye": "leftEye",
    "mixamorig:RightEye": "rightEye",

    "mixamorig:LeftShoulder": "leftShoulder",
    "mixamorig:LeftArm": "leftUpperArm",
    "mixamorig:LeftForeArm": "leftLowerArm",
    "mixamorig:LeftHand": "leftHand",
    "mixamorig:RightShoulder": "rightShoulder",
    "mixamorig:RightArm": "rightUpperArm",
    "mixamorig:RightForeArm": "rightLowerArm",
    "mixamorig:RightHand": "rightHand",

    "mixamorig:LeftHandThumb1": "leftThumbProximal",
    "mixamorig:LeftHandThumb2": "leftThumbIntermediate",
    "mixamorig:LeftHandThumb3": "leftThumbDistal",
    "mixamorig:LeftHandIndex1": "leftIndexProximal",
    "mixamorig:LeftHandIndex2": "leftIndexIntermediate",
    "mixamorig:LeftHandIndex3": "leftIndexDistal",
    "mixamorig:LeftHandMiddle1": "leftMiddleProximal",
    "mixamorig:LeftHandMiddle2": "leftMiddleIntermediate",
    "mixamorig:LeftHandMiddle3": "leftMiddleDistal",
    "mixamorig:LeftHandRing1": "leftRingProximal",
    "mixamorig:LeftHandRing2": "leftRingIntermediate",
    "mixamorig:LeftHandRing3": "leftRingDistal",
    "mixamorig:LeftHandPinky1": "leftLittleProximal",
    "mixamorig:LeftHandPinky2": "leftLittleIntermediate",
    "mixamorig:LeftHandPinky3": "leftLittleDistal",

    "mixamorig:RightHandThumb1": "rightThumbProximal",
    "mixamorig:RightHandThumb2": "rightThumbIntermediate",
    "mixamorig:RightHandThumb3": "rightThumbDistal",
    "mixamorig:RightHandIndex1": "rightIndexProximal",
    "mixamorig:RightHandIndex2": "rightIndexIntermediate",
    "mixamorig:RightHandIndex3": "rightIndexDistal",
    "mixamorig:RightHandMiddle1": "rightMiddleProximal",
    "mixamorig:RightHandMiddle2": "rightMiddleIntermediate",
    "mixamorig:RightHandMiddle3": "rightMiddleDistal",
    "mixamorig:RightHandRing1": "rightRingProximal",
    "mixamorig:RightHandRing2": "rightRingIntermediate",
    "mixamorig:RightHandRing3": "rightRingDistal",
    "mixamorig:RightHandPinky1": "rightLittleProximal",
    "mixamorig:RightHandPinky2": "rightLittleIntermediate",
    "mixamorig:RightHandPinky3": "rightLittleDistal",

    "mixamorig:LeftUpLeg": "leftUpperLeg",
    "mixamorig:LeftLeg": "leftLowerLeg",
    "mixamorig:LeftFoot": "leftFoot",
    "mixamorig:LeftToeBase": "leftToes",
    "mixamorig:LeftToe_End": "leftToesEnd",
    "mixamorig:RightUpLeg": "rightUpperLeg",
    "mixamorig:RightLeg": "rightLowerLeg",
    "mixamorig:RightFoot": "rightFoot",
    "mixamorig:RightToeBase": "rightToes",
    "mixamorig:RightToe_End": "rightToesEnd",
}


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    if len(argv) < 2:
        print("Usage: blender --background --python fbx-to-bvh.py -- INPUT.fbx OUTPUT.bvh", file=sys.stderr)
        sys.exit(2)
    return argv[0], argv[1]


def main():
    input_fbx, output_bvh = parse_args()
    print(f"[fbx2bvh] {input_fbx} → {output_bvh}")

    # Clean slate
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import the FBX. automatic_bone_orientation=True makes Blender pick a
    # sensible bone-roll for each joint, which avoids weird arm-axis issues
    # on export. use_anim=True keeps the animation action.
    bpy.ops.import_scene.fbx(
        filepath=input_fbx,
        automatic_bone_orientation=True,
        use_anim=True,
        ignore_leaf_bones=False,
    )

    # Find the armature (Mixamo exports always have exactly one)
    armature = None
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            armature = obj
            break
    if armature is None:
        print("[fbx2bvh] ERROR: no armature in FBX", file=sys.stderr)
        sys.exit(1)

    # Enter edit mode to rename bones (only available in edit mode)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="EDIT")
    renamed = 0
    untouched = []
    for bone in armature.data.edit_bones:
        if bone.name in BONE_RENAME:
            bone.name = BONE_RENAME[bone.name]
            renamed += 1
        elif bone.name.startswith("mixamorig:"):
            # Fallback: strip prefix, lowercase first letter
            suffix = bone.name[len("mixamorig:"):]
            bone.name = suffix[0].lower() + suffix[1:]
            renamed += 1
        else:
            untouched.append(bone.name)
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"[fbx2bvh] renamed {renamed} bones; untouched: {untouched[:5]}{'...' if len(untouched) > 5 else ''}")

    # Select only the armature for BVH export
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)

    # Export BVH. global_scale=1 is correct for Mixamo's cm-units exports.
    # root_transform_only=False keeps rotation on all bones (we strip Hips
    # position later in our BVH retargeter, not here).
    bpy.ops.export_anim.bvh(
        filepath=output_bvh,
        frame_start=int(bpy.context.scene.frame_start),
        frame_end=int(bpy.context.scene.frame_end),
        global_scale=1.0,
        rotate_mode="NATIVE",
        root_transform_only=False,
    )
    print(f"[fbx2bvh] OK → {output_bvh}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[fbx2bvh] FAIL: {e}", file=sys.stderr)
        sys.exit(1)
