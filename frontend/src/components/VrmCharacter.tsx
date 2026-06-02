import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  VRM,
  VRMExpressionPresetName,
  VRMHumanBoneName,
  VRMLoaderPlugin,
  VRMUtils,
} from "@pixiv/three-vrm";
import {
  idleClipForPose,
  useCharacter,
  type Mood,
  type Pose,
} from "../store/characterStore";
import {
  animationUrl,
  loadBvhClip,
  THINKING_VARIANTS,
  type AnimationName,
} from "../lib/bvhLoader";
import { loadFbxClip } from "../lib/fbxLoader";
import { isTtsSpeaking, onMouthAmplitude } from "../lib/tts";

// Pose-specific body data is no longer driven procedurally — BVH clips
// take over once they load. See store/characterStore.ts for idleClipForPose
// which maps poses to looping idle clips (sit_idle, kneel_idle, etc.).
// Initial arm A-pose (set at load time before clips arrive) is applied
// inline in the GLTFLoader callback below.


// Loads a .vrm file and exposes the parsed VRM object. Falls back to a friendly
// "model missing" state so the integration ships even if the user hasn't
// dropped their .vrm file into public/ yet.
function useVRM(url: string): {
  vrm: VRM | null;
  error: string | null;
  loading: boolean;
} {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    setLoading(true);
    setError(null);

    loader.load(
      url,
      (gltf) => {
        if (cancelled) return;
        const loaded = gltf.userData.vrm as VRM | undefined;
        if (!loaded) {
          setError("file loaded but no VRM extension found");
          setLoading(false);
          return;
        }
        VRMUtils.removeUnnecessaryVertices(loaded.scene);
        loaded.scene.traverse((obj) => {
          if ("frustumCulled" in obj) {
            (obj as THREE.Object3D).frustumCulled = false;
          }
        });
        // Face the camera.
        VRMUtils.rotateVRM0(loaded);

        // Apply a relaxed A-pose so she's not standing arms-out like a
        // Christ-the-Redeemer statue. Without this, default VRoid exports
        // are T-pose and hair tends to clip through the arms.
        const setBoneRot = (
          name: VRMHumanBoneName,
          x = 0,
          y = 0,
          z = 0
        ) => {
          const node = loaded.humanoid?.getNormalizedBoneNode(name);
          if (node) node.rotation.set(x, y, z);
        };
        // arms DOWN at sides — sign convention: left arm extends along +X in
        // T-pose, negative Z rotation drops it; right arm is mirrored.
        setBoneRot(VRMHumanBoneName.LeftUpperArm, 0, 0, 1.3);
        setBoneRot(VRMHumanBoneName.RightUpperArm, 0, 0, -1.3);
        // very slight elbow bend forward (x axis) for a relaxed posture
        setBoneRot(VRMHumanBoneName.LeftLowerArm, -0.15, 0, 0);
        setBoneRot(VRMHumanBoneName.RightLowerArm, -0.15, 0, 0);
        // hands hang naturally
        setBoneRot(VRMHumanBoneName.LeftHand, 0, 0, 0);
        setBoneRot(VRMHumanBoneName.RightHand, 0, 0, 0);

        // Auto-normalize size so any VRoid character fits the camera framing.
        // Done AFTER the A-pose because the bbox changes once arms come down.
        const box = new THREE.Box3().setFromObject(loaded.scene);
        const size = box.getSize(new THREE.Vector3());
        const TARGET_HEIGHT = 1.55;
        if (size.y > 0.01) {
          const s = TARGET_HEIGHT / size.y;
          loaded.scene.scale.setScalar(s);
          // Re-measure after scale to anchor feet at y=0.
          const newBox = new THREE.Box3().setFromObject(loaded.scene);
          loaded.scene.position.y -= newBox.min.y;
        }
        // Remember the standing y so pose changes can lerp the body lower.
        loaded.scene.userData.baseY = loaded.scene.position.y;

        // Hair physics — moderate gravity so wispy strands (including the
        // ahoge) drape naturally. Soft stiffness lets them respond to body
        // sway. The ahoge is intentional design — we keep the mesh and let
        // physics make it flow.
        const sbm = loaded.springBoneManager;
        if (sbm) {
          let n = 0;
          sbm.joints.forEach((joint) => {
            joint.settings.gravityPower = 0.7;
            joint.settings.stiffness = 0.75;
            joint.settings.dragForce = 0.75;
            n++;
          });
          console.log(`[Shadows VRM] tuned ${n} spring-bone joints`);
        } else {
          console.warn(
            "[Shadows VRM] no spring bones — hair will not animate. Re-export from VRoid Studio with spring bones enabled."
          );
        }

        setVrm(loaded);
        setLoading(false);
      },
      undefined,
      (err) => {
        if (cancelled) return;
        setError(
          (err as Error)?.message ?? `could not load ${url}. Place a .vrm there.`
        );
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { vrm, error, loading };
}

interface CharacterProps {
  url: string;
  mouthOpenRef?: React.MutableRefObject<number>;
  expressionRef?: React.MutableRefObject<VRMExpressionPresetName | null>;
}

function Character({ url, mouthOpenRef, expressionRef }: CharacterProps) {
  const { vrm } = useVRM(url);
  const { mouse } = useThree();
  const blinkTimeoutRef = useRef(0);
  const blinkingRef = useRef(false);
  const blinkStartRef = useRef(0);
  const smoothMouthRef = useRef(0);

  // Mirror the Zustand store into a ref so useFrame can read without
  // re-rendering the Canvas tree every state change.
  const stateRef = useRef({
    mood: useCharacter.getState().mood,
    pose: useCharacter.getState().pose,
    isSpeaking: useCharacter.getState().isSpeaking,
  });
  useEffect(() => {
    return useCharacter.subscribe((s) => {
      stateRef.current = {
        mood: s.mood,
        pose: s.pose,
        isSpeaking: s.isSpeaking,
      };
    });
  }, []);

  useEffect(() => {
    if (!mouthOpenRef) return;
    return onMouthAmplitude((amp) => {
      mouthOpenRef.current = amp;
    });
  }, [mouthOpenRef]);

  // ---- AnimationMixer + clip plumbing ------------------------------------
  // One mixer per loaded VRM. We cache parsed clips by name; cache actions
  // by name so repeated triggers don't re-create them.
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const finishedListenerRef = useRef<
    ((e: { action: THREE.AnimationAction }) => void) | null
  >(null);

  // Once the VRM is ready, init the mixer and play the entrance sequence:
  // walks in → opens a door → thinks → settles into the default idle.
  useEffect(() => {
    if (!vrm) return;
    const mixer = new THREE.AnimationMixer(vrm.scene);
    mixerRef.current = mixer;

    let cancelled = false;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    async function playIntro() {
      const thinkingPick =
        THINKING_VARIANTS[Math.floor(Math.random() * THINKING_VARIANTS.length)];
      // Per-step config:
      //   mode: "loop"  → cycle the clip for the holdMs window
      //          "once" → play exactly once at natural duration
      //          "final" → loop forever, no advance
      //   holdMs: only used when mode === "loop"; otherwise use clip.duration
      const sequence: {
        name: AnimationName;
        mode: "loop" | "once" | "final";
        holdMs?: number;
      }[] = [
        // Long walk-in past the ~5s boot screen — many stride cycles.
        { name: "male_walking", mode: "loop", holdMs: 7000 },
        // Door opens once, end-to-end. Looping plays it twice → wrong.
        { name: "male_door_open", mode: "once" },
        // One thinking gesture at natural length.
        { name: thinkingPick, mode: "once" },
        // Settle into the default resting idle for the rest of the session.
        { name: idleClipForPose(useCharacter.getState().pose), mode: "final" },
      ];

      for (const step of sequence) {
        if (cancelled || mixerRef.current !== mixer) return;
        const url = animationUrl(step.name);
        let clip: THREE.AnimationClip;
        try {
          clip = url.toLowerCase().endsWith(".fbx")
            ? await loadFbxClip(url, vrm!)
            : await loadBvhClip(url, vrm!);
        } catch (e) {
          console.warn(`[Shadows VRM] intro step '${step.name}' failed:`, e);
          continue;
        }
        if (cancelled || mixerRef.current !== mixer) return;
        const mixerMode = step.mode === "once" ? "once" : "loop";
        playClipOnMixer(step.name, mixerMode, 250);
        if (step.mode === "final") return;
        const hold =
          step.mode === "loop"
            ? step.holdMs ?? clip.duration * 1000
            : clip.duration * 1000;
        await sleep(hold);
      }
    }
    playIntro();

    return () => {
      cancelled = true;
      mixer.stopAllAction();
      actionsRef.current.clear();
      currentActionRef.current = null;
      mixerRef.current = null;
      if (finishedListenerRef.current) {
        mixer.removeEventListener("finished", finishedListenerRef.current);
        finishedListenerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrm]);

  // Subscribe to store changes for activeClip + pose transitions.
  useEffect(() => {
    if (!vrm) return;
    let prevActiveKey: string | null = clipKey(
      useCharacter.getState().activeClip
    );
    let prevPose: Pose = useCharacter.getState().pose;

    const unsub = useCharacter.subscribe((state) => {
      const k = clipKey(state.activeClip);
      if (k !== prevActiveKey) {
        prevActiveKey = k;
        if (state.activeClip) {
          playClipOnMixer(
            state.activeClip.name,
            state.activeClip.mode,
            300
          );
        } else {
          // No explicit clip → fall back to the pose's idle.
          playClipOnMixer(idleClipForPose(state.pose), "loop", 350);
        }
      }
      if (state.pose !== prevPose) {
        prevPose = state.pose;
        // If nothing else is forcing a clip, switch idle to match the pose.
        if (!state.activeClip) {
          playClipOnMixer(idleClipForPose(state.pose), "loop", 350);
        }
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrm]);

  async function playClipOnMixer(
    name: AnimationName,
    mode: "loop" | "once",
    fadeMs: number
  ) {
    const url = animationUrl(name);
    const vrmInst = vrm;
    const mixer = mixerRef.current;
    if (!vrmInst || !mixer) return;

    let clip: THREE.AnimationClip;
    try {
      clip = url.toLowerCase().endsWith(".fbx")
        ? await loadFbxClip(url, vrmInst)
        : await loadBvhClip(url, vrmInst);
    } catch (e) {
      console.warn(`[Shadows VRM] failed to load animation '${name}':`, e);
      return;
    }
    // Bail if the mixer got torn down during the async load.
    if (mixerRef.current !== mixer) return;

    let action = actionsRef.current.get(name);
    if (!action) {
      action = mixer.clipAction(clip);
      actionsRef.current.set(name, action);
    }
    action.setLoop(
      mode === "loop" ? THREE.LoopRepeat : THREE.LoopOnce,
      mode === "loop" ? Infinity : 1
    );
    action.clampWhenFinished = mode === "once";

    const prev = currentActionRef.current;
    action.reset();
    if (fadeMs > 0) {
      action.fadeIn(fadeMs / 1000);
      if (prev && prev !== action) prev.fadeOut(fadeMs / 1000);
    } else {
      action.setEffectiveWeight(1);
      if (prev && prev !== action) prev.stop();
    }
    action.play();
    currentActionRef.current = action;

    // For one-shots, listen for completion so we can clear activeClip and
    // crossfade back to the pose idle.
    if (mode === "once") {
      // Capture the startedAt from the request so we only clear the same
      // request, not a newer one that fired in the meantime.
      const startedAt = useCharacter.getState().activeClip?.startedAt ?? 0;
      // Replace any prior listener to avoid leaking handlers.
      if (finishedListenerRef.current) {
        mixer.removeEventListener("finished", finishedListenerRef.current);
      }
      const onFinished = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== action) return;
        useCharacter.getState().clipFinished(name, startedAt);
      };
      finishedListenerRef.current = onFinished;
      mixer.addEventListener("finished", onFinished);
    }
  }

  useFrame((state, delta) => {
    if (!vrm) return;

    // Body motion is fully driven by the AnimationMixer (BVH clips).
    // Procedural sine-wave motion on hips/spine/chest was removed because
    // it fought with the clips. Spring bones still update via vrm.update.
    vrm.update(delta);
    mixerRef.current?.update(delta);

    const t = state.clock.getElapsedTime();
    const { mood, isSpeaking } = stateRef.current;

    // After 60s of no activity, kick off a random dance once.
    useCharacter.getState().checkAutoDance();

    // Cursor tracking — small ADDITIVE rotation on top of the clip's
    // head motion. Tiny intensities so the clip remains dominant.
    const head = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    if (head) {
      const extraX = THREE.MathUtils.clamp(mouse.y * 0.1, -0.18, 0.18);
      const extraY = THREE.MathUtils.clamp(mouse.x * 0.15, -0.22, 0.22);
      head.rotation.x += extraX;
      head.rotation.y += extraY;
    }

    // Blink (~every 3–6s).
    if (!blinkingRef.current) {
      blinkTimeoutRef.current -= delta;
      if (blinkTimeoutRef.current <= 0) {
        blinkingRef.current = true;
        blinkStartRef.current = t;
      }
    }
    if (blinkingRef.current) {
      const duration = 0.18;
      const phase = (t - blinkStartRef.current) / duration;
      const value = phase < 1 ? Math.sin(phase * Math.PI) : 0;
      vrm.expressionManager?.setValue(VRMExpressionPresetName.Blink, value);
      if (phase >= 1) {
        blinkingRef.current = false;
        blinkTimeoutRef.current = 3 + Math.random() * 3;
      }
    }

    const em = vrm.expressionManager;

    const ttsMouth = mouthOpenRef?.current ?? 0;
    const smoothing = 1 - Math.exp(-delta / 0.08);
    smoothMouthRef.current = THREE.MathUtils.lerp(
      smoothMouthRef.current,
      ttsMouth,
      smoothing
    );

    if (isTtsSpeaking()) {
      em?.setValue(
        VRMExpressionPresetName.Aa,
        THREE.MathUtils.clamp(smoothMouthRef.current, 0, 1)
      );
    } else if (isSpeaking) {
      const wave = (Math.sin(t * 12) + 1) * 0.5;
      const noise = (Math.sin(t * 17.3) + 1) * 0.25;
      em?.setValue(
        VRMExpressionPresetName.Aa,
        THREE.MathUtils.clamp(wave * 0.5 + noise, 0, 0.7)
      );
    } else {
      smoothMouthRef.current = THREE.MathUtils.lerp(
        smoothMouthRef.current,
        0,
        smoothing
      );
      em?.setValue(VRMExpressionPresetName.Aa, 0);
    }

    // Mood expressions — face only (body is driven by the clip).
    const moodPresets: Record<Mood, VRMExpressionPresetName | null> = {
      idle: null,
      thinking: VRMExpressionPresetName.Relaxed,
      happy: VRMExpressionPresetName.Happy,
      sad: VRMExpressionPresetName.Sad,
      surprised: VRMExpressionPresetName.Surprised,
      laughing: VRMExpressionPresetName.Happy,
    };
    const moodIntensity: Record<Mood, number> = {
      idle: 0,
      thinking: 0.6,
      happy: 0.9,
      sad: 0.8,
      surprised: 0.95,
      laughing: 1.0,
    };
    const forcedExpr = expressionRef?.current ?? null;
    const allExprs: VRMExpressionPresetName[] = [
      VRMExpressionPresetName.Happy,
      VRMExpressionPresetName.Angry,
      VRMExpressionPresetName.Sad,
      VRMExpressionPresetName.Relaxed,
      VRMExpressionPresetName.Surprised,
    ];
    const moodExpr = moodPresets[mood];
    for (const p of allExprs) {
      let value = 0;
      if (forcedExpr === p) value = 0.7;
      else if (moodExpr === p) value = moodIntensity[mood];
      em?.setValue(p, value);
    }

    em?.update();
  });

  if (!vrm) return null;
  return <primitive object={vrm.scene} />;
}

// Stable string id for an ActiveClip so subscribe transitions can be
// detected without deep-equal. Includes startedAt because the same clip
// name re-played counts as a transition.
function clipKey(
  clip: { name: string; mode: string; startedAt: number } | null
): string | null {
  if (!clip) return null;
  return `${clip.name}|${clip.mode}|${clip.startedAt}`;
}

function MissingModelHint() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="glass rounded-md p-3 max-w-xs text-center text-[11px] text-dsos-bone">
        <div className="script text-dsos-glow text-glow text-base mb-1">
          No VRM loaded
        </div>
        <div className="text-dsos-ghost mb-2">
          Drop your exported VRM at{" "}
          <span className="mono text-dsos-glow">
            frontend/public/oracle.vrm
          </span>{" "}
          and refresh.
        </div>
        <div className="text-dsos-ghost text-[10px] leading-snug">
          Open your .vroid in VRoid Studio → Export → VRM. Default options are
          fine.
        </div>
      </div>
    </div>
  );
}

interface VrmCharacterProps {
  src?: string;
  mouthOpenRef?: React.MutableRefObject<number>;
  expressionRef?: React.MutableRefObject<VRMExpressionPresetName | null>;
}

export function VrmCharacter({
  src = "/oracle.vrm",
  mouthOpenRef,
  expressionRef,
}: VrmCharacterProps) {
  const internalMouthOpenRef = useRef(0);
  const activeMouthOpenRef = mouthOpenRef ?? internalMouthOpenRef;
  // Probe whether the file exists so we can show the hint without spamming
  // the Three.js loader with errors on every render.
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    fetch(src, { method: "HEAD" })
      .then((r) => setAvailable(r.ok))
      .catch(() => setAvailable(false));
  }, [src]);

  if (available === false) return <MissingModelHint />;

  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: [0, 0.95, 3.0], fov: 30 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
        style={{ background: "transparent" }}
      >
        <CameraRig
          // Full-body framing — looking slightly up from chest level, far
          // enough back to fit head + feet with margin. Tune pz to zoom.
          px={0}
          py={0.95}
          pz={3.0}
          lx={0}
          ly={0.85}
          lz={0}
        />
        {/* 3-point-ish lighting: neutral ambient + warm key + cool fill + a
            subtle flame-tinged rim from behind for the DSOS aesthetic. */}
        <ambientLight intensity={0.85} color="#fff5e6" />
        <directionalLight
          position={[1.5, 2, 2]}
          intensity={1.0}
          color="#ffffff"
        />
        <directionalLight
          position={[-1.5, 0.5, 1]}
          intensity={0.35}
          color="#9ec5ff"
        />
        <directionalLight
          position={[0, 1, -2]}
          intensity={0.25}
          color="#ff6a2a"
        />
        {available && (
          <Character
            url={src}
            mouthOpenRef={activeMouthOpenRef}
            expressionRef={expressionRef}
          />
        )}
      </Canvas>
    </div>
  );
}

function CameraRig({
  px,
  py,
  pz,
  lx,
  ly,
  lz,
}: {
  px: number;
  py: number;
  pz: number;
  lx: number;
  ly: number;
  lz: number;
}) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(px, py, pz);
    camera.lookAt(lx, ly, lz);
    camera.updateProjectionMatrix();
  }, [camera, px, py, pz, lx, ly, lz]);
  return null;
}
