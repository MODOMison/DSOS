# Animation Credits

## Current library

DSOS ships with 101 BVH motion-capture clips covering idles, emotions, actions, and dances. Source: a community-shared "Silly-Tavern VRM Assets Pack" (origin uncertain — likely Mixamo-derived).

**Status: under review for commercial distribution.** Before shipping DSOS publicly, plan to either:
1. Replace with a known-licensed set (Mixamo with your own Adobe account, or Truebones), OR
2. Verify the origin and license of each clip in the current pack.

## Rolled-back: CMU Motion Capture Database

A ~388-clip pull from the Carnegie-Mellon Mocap Database (via the una-dinosauria GitHub mirror) was attempted but rolled back. Reason: CMU's skeleton has a different bind-pose than VRM, particularly around the hips (CMU has an extra `LHipJoint` segment that orients the legs at a slight outward angle in T-pose). Direct bone-name retargeting produced visible artifacts — crossed legs, contorted poses — that couldn't be fixed at the retargeter level without proper T-pose calibration.

The CMU set remains legally clean (commercial-use OK) so it's worth revisiting if/when DSOS gains a proper retargeting pipeline (Mixamo Auto-Rigger, Cascadeur, or equivalent).

Source script: `scripts/pull-cmu-animations.cjs` and `scripts/pull-cmu-bulk.cjs`, both preserved for future use.


## Mixamo pack (added 2026-05-26)

65 clips converted from Mixamo FBX exports via Blender headless (`scripts/convert-mixamo-pack.cjs` + `scripts/fbx-to-bvh.py`).

**License:** Mixamo (Adobe) content. Per Mixamo's terms, animations may be incorporated into commercial works when downloaded via an Adobe account. License does not permit redistribution as standalone files — DSOS bundles them inside the application, which is the permitted use.

### Classification breakdown
- **sad**: 2
- **dance**: 25
- **walk**: 9
- **happy**: 2
- **energetic**: 1
- **thinking**: 3
- **idle**: 3
- **greeting**: 1
- **unpooled**: 19 (catalogued but not in auto-rotation pools)

### Clip list
- `mixamo_angry.bvh` — sad — from `Angry.fbx`
- `mixamo_arms_hip_hop_dance.bvh` — dance — from `Arms Hip Hop Dance.fbx`
- `mixamo_bellydancing.bvh` — dance — from `Bellydancing.fbx`
- `mixamo_booty_hip_hop_dance.bvh` — dance — from `Booty Hip Hop Dance.fbx`
- `mixamo_catwalk_walk_forward_highknees.bvh` — walk — from `Catwalk Walk Forward HighKnees.fbx`
- `mixamo_catwalk_walk_start_backwards_180l.bvh` — walk — from `Catwalk Walk Start Backwards 180L.fbx`
- `mixamo_catwalk_walk.bvh` — walk — from `Catwalk Walk.fbx`
- `mixamo_crazy_gesture.bvh` — unpooled — from `Crazy Gesture.fbx`
- `mixamo_crying.bvh` — sad — from `Crying.fbx`
- `mixamo_dancing_1.bvh` — dance — from `Dancing (1).fbx`
- `mixamo_dancing.bvh` — dance — from `Dancing.fbx`
- `mixamo_excited.bvh` — happy — from `Excited.fbx`
- `mixamo_falling.bvh` — energetic — from `Falling.fbx`
- `mixamo_female_peek_and_aim.bvh` — thinking — from `Female Peek And Aim.fbx`
- `mixamo_femme_peek_around_corner.bvh` — thinking — from `Femme Peek Around Corner.fbx`
- `mixamo_focus.bvh` — thinking — from `Focus.fbx`
- `mixamo_happy.bvh` — happy — from `Happy.fbx`
- `mixamo_hip_hop_dancing_1.bvh` — dance — from `Hip Hop Dancing (1).fbx`
- `mixamo_hip_hop_dancing_2.bvh` — dance — from `Hip Hop Dancing (2).fbx`
- `mixamo_hip_hop_dancing_3.bvh` — dance — from `Hip Hop Dancing (3).fbx`
- `mixamo_hip_hop_dancing_4.bvh` — dance — from `Hip Hop Dancing (4).fbx`
- `mixamo_hip_hop_dancing_5.bvh` — dance — from `Hip Hop Dancing (5).fbx`
- `mixamo_hip_hop_dancing_6.bvh` — dance — from `Hip Hop Dancing (6).fbx`
- `mixamo_hip_hop_dancing_7.bvh` — dance — from `Hip Hop Dancing (7).fbx`
- `mixamo_hip_hop_dancing_8.bvh` — dance — from `Hip Hop Dancing (8).fbx`
- `mixamo_hip_hop_dancing.bvh` — dance — from `Hip Hop Dancing.fbx`
- `mixamo_idle.bvh` — idle — from `Idle.fbx`
- `mixamo_jazz_dancing.bvh` — dance — from `Jazz Dancing.fbx`
- `mixamo_leaning_on_a_wall.bvh` — unpooled — from `Leaning On A Wall.fbx`
- `mixamo_left_turn.bvh` — unpooled — from `Left Turn.fbx`
- `mixamo_macarena_dance.bvh` — dance — from `Macarena Dance.fbx`
- `mixamo_ninja_idle_1.bvh` — idle — from `Ninja Idle (1).fbx`
- `mixamo_ninja_idle.bvh` — idle — from `Ninja Idle.fbx`
- `mixamo_pacing_and_talking_on_a_phone.bvh` — unpooled — from `Pacing And Talking On A Phone.fbx`
- `mixamo_plotting.bvh` — unpooled — from `Plotting.fbx`
- `mixamo_rejected.bvh` — unpooled — from `Rejected.fbx`
- `mixamo_right_turn.bvh` — unpooled — from `Right Turn.fbx`
- `mixamo_rumba_dancing.bvh` — dance — from `Rumba Dancing.fbx`
- `mixamo_run.bvh` — walk — from `Run.fbx`
- `mixamo_salsa_dancing.bvh` — dance — from `Salsa Dancing.fbx`
- `mixamo_samba_dancing_1.bvh` — dance — from `Samba Dancing (1).fbx`
- `mixamo_samba_dancing_2.bvh` — dance — from `Samba Dancing (2).fbx`
- `mixamo_samba_dancing_3.bvh` — dance — from `Samba Dancing (3).fbx`
- `mixamo_samba_dancing.bvh` — dance — from `Samba Dancing.fbx`
- `mixamo_snake_hip_hop_dance.bvh` — dance — from `Snake Hip Hop Dance.fbx`
- `mixamo_standing_greeting.bvh` — greeting — from `Standing Greeting.fbx`
- `mixamo_step_hip_hop_dance.bvh` — dance — from `Step Hip Hop Dance.fbx`
- `mixamo_talking_1.bvh` — unpooled — from `Talking (1).fbx`
- `mixamo_talking_on_phone.bvh` — unpooled — from `Talking On Phone.fbx`
- `mixamo_talking.bvh` — unpooled — from `Talking.fbx`
- `mixamo_taunt.bvh` — unpooled — from `Taunt.fbx`
- `mixamo_texting_and_walking.bvh` — walk — from `Texting And Walking.fbx`
- `mixamo_thankful.bvh` — unpooled — from `Thankful.fbx`
- `mixamo_threatening.bvh` — unpooled — from `Threatening.fbx`
- `mixamo_twist_dance.bvh` — dance — from `Twist Dance.fbx`
- `mixamo_walk_in_circle.bvh` — walk — from `Walk In Circle.fbx`
- `mixamo_x_bot.bvh` — unpooled — from `X Bot.fbx`
- `mixamo_gangnam_style.bvh` — unpooled — from `gangnam style.fbx`
- `mixamo_jump.bvh` — unpooled — from `jump.fbx`
- `mixamo_left_strafe_walking.bvh` — walk — from `left strafe walking.fbx`
- `mixamo_left_turn_90.bvh` — unpooled — from `left turn 90.fbx`
- `mixamo_right_strafe_walking.bvh` — walk — from `right strafe walking.fbx`
- `mixamo_right_turn_90.bvh` — unpooled — from `right turn 90.fbx`
- `mixamo_skinning_test.bvh` — unpooled — from `skinning test.fbx`
- `mixamo_walking.bvh` — walk — from `walking.fbx`
