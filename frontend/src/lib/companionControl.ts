// Desktop-Mate-style physical interaction for the Shadow companion window.
//
// Grab the character anywhere and fling him around the screen; a quick tap
// (no travel) still registers as a poke. On release a throw glides with
// inertia, then snaps flush to the nearest screen edge and "perches" there.
// Mouse-wheel scales him up/down.
//
// Only active inside the Electron *companion* window (frameless, transparent,
// always-on-top — see electron/main.cjs). In the browser, or in the main
// desktop window where the same VRM renders as a background, every entry point
// no-ops and the caller falls back to a plain poke.

import { useCharacter } from "../store/characterStore";

type Bounds = { x: number; y: number; width: number; height: number };

interface DsosBridge {
  isElectron?: boolean;
  companionGetBounds?: () => Promise<Bounds | null>;
  companionSetPos?: (x: number, y: number) => Promise<void>;
  companionSetSize?: (w: number, h: number) => Promise<void>;
  companionGetWorkArea?: () => Promise<Bounds>;
}

function bridge(): DsosBridge | null {
  const w = window as unknown as { dsos?: DsosBridge };
  return w.dsos ?? null;
}

// Temporary diagnostics → main-process terminal (see electron/preload.cjs).
function dbg(msg: string): void {
  const w = window as unknown as { dsos?: { debug?: (m: string) => void } };
  w.dsos?.debug?.(msg);
}

// Only the dedicated companion window should move/resize itself. The main
// desktop renders the same character as a backdrop — dragging that must never
// fling the companion window around.
function inCompanionMode(): boolean {
  return new URLSearchParams(window.location.search).get("mode") === "companion";
}

export function canDragCompanion(): boolean {
  const b = bridge();
  return inCompanionMode() && !!(b && b.companionSetPos && b.companionGetBounds);
}

const DRAG_THRESHOLD = 6; // px of screen travel before a press becomes a drag
const SNAP = 40; // px from a work-area edge that snaps flush + perches
const FRICTION = 0.9; // per-frame velocity decay during a throw
const BASE_W = 420; // must match createCompanionWindow() in electron/main.cjs
const BASE_H = 560;

let scale = 1;

// Entry point: call from the character's onPointerDown with the native event.
// If we're not in a draggable companion, we just poke immediately.
export function beginCharacterGrab(
  e: PointerEvent,
  opts: { onPoke: () => void }
): void {
  const b = bridge();
  if (!canDragCompanion() || !b?.companionSetPos) {
    dbg(`grab ignored (canDrag=${canDragCompanion()})`);
    opts.onPoke();
    return;
  }

  // The cursor's offset within the window stays constant while we keep the
  // grabbed pixel under it, so the window's screen origin is simply
  // (cursorScreen - cursorClient). Fully synchronous — no getBounds round-trip,
  // which is what was dropping the very first moves before.
  const offX = e.clientX;
  const offY = e.clientY;
  const pointerId = e.pointerId;
  const target = e.target as Element | null;

  let moved = 0;
  let dragging = false;
  let lastSX = e.screenX;
  let lastSY = e.screenY;
  let lastT = performance.now();
  let vx = 0;
  let vy = 0;
  let pos = { x: e.screenX - offX, y: e.screenY - offY };

  try {
    target?.setPointerCapture?.(pointerId);
  } catch {
    /* window listeners still cover it */
  }

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const now = performance.now();
    const dt = Math.max(now - lastT, 1);
    const dx = ev.screenX - lastSX;
    const dy = ev.screenY - lastSY;
    lastSX = ev.screenX;
    lastSY = ev.screenY;
    lastT = now;
    moved += Math.abs(dx) + Math.abs(dy);
    vx = vx * 0.6 + (dx / dt) * 0.4;
    vy = vy * 0.6 + (dy / dt) * 0.4;

    if (!dragging && moved > DRAG_THRESHOLD) {
      dragging = true;
      document.body.style.cursor = "grabbing";
      detachForDrag(); // taking manual control — stop riding panels
      useCharacter.getState().onGrabbed();
      dbg("grab: drag start");
    }
    if (dragging) {
      pos = { x: ev.screenX - offX, y: ev.screenY - offY };
      void b.companionSetPos!(pos.x, pos.y);
    }
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
    document.body.style.cursor = "";
    try {
      target?.releasePointerCapture?.(pointerId);
    } catch {
      /* nothing captured */
    }
    if (!dragging) {
      opts.onPoke();
      return;
    }
    throwAndSettle({ x: pos.x, y: pos.y, vx, vy });
  };

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
}

function throwAndSettle(start: {
  x: number;
  y: number;
  vx: number;
  vy: number;
}) {
  const b = bridge();
  if (!b?.companionSetPos) return;

  const pos = { x: start.x, y: start.y };
  const thrown = Math.hypot(start.vx, start.vy) > 0.6;
  if (!thrown) {
    void snapToEdges(pos, false);
    return;
  }

  let vx = start.vx;
  let vy = start.vy;
  let last = performance.now();
  let raf = 0;

  const step = () => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    pos.x += vx * dt;
    pos.y += vy * dt;
    vx *= FRICTION;
    vy *= FRICTION;
    void b.companionSetPos!(pos.x, pos.y);
    if (Math.hypot(vx, vy) > 0.02) {
      raf = requestAnimationFrame(step);
    } else {
      cancelAnimationFrame(raf);
      void snapToEdges(pos, true);
    }
  };
  raf = requestAnimationFrame(step);
}

async function snapToEdges(pos: { x: number; y: number }, thrown: boolean) {
  const b = bridge();
  if (!b?.companionSetPos || !b.companionGetWorkArea) return;
  const wa = await b.companionGetWorkArea();
  const w = BASE_W * scale;
  const h = BASE_H * scale;

  // Keep him fully on the current display first.
  let x = Math.min(Math.max(pos.x, wa.x), wa.x + wa.width - w);
  let y = Math.min(Math.max(pos.y, wa.y), wa.y + wa.height - h);

  // Then snap flush to any edge he's hovering near, and perch.
  let perched = false;
  if (x - wa.x < SNAP) {
    x = wa.x;
    perched = true;
  }
  if (wa.x + wa.width - (x + w) < SNAP) {
    x = wa.x + wa.width - w;
    perched = true;
  }
  if (wa.y + wa.height - (y + h) < SNAP) {
    y = wa.y + wa.height - h;
    perched = true;
  }

  void b.companionSetPos(x, y);

  if (perched) useCharacter.getState().onPerch();
  else if (thrown) useCharacter.getState().onLanded();
}

// Mouse-wheel → scale the Shadow between 0.5x and 1.8x, anchored at his feet.
export function nudgeCompanionScale(deltaY: number) {
  const b = bridge();
  if (!canDragCompanion() || !b?.companionSetSize) return;
  const dir = deltaY < 0 ? 1 : -1; // wheel up = bigger
  const next = Math.min(1.8, Math.max(0.5, scale + dir * 0.08));
  if (next === scale) return;
  scale = next;
  void b.companionSetSize(Math.round(BASE_W * scale), Math.round(BASE_H * scale));
}

// ───────────────────────── Panel riding ─────────────────────────
// The Shadow perches on the focused DSOS window and follows it around. The
// main desktop reports the focused panel's rect; electron/main.cjs converts it
// to screen coordinates and forwards it here. We glide the companion so his
// feet rest on the panel's top edge, and re-perch (with a comment) whenever the
// focused app changes. Grabbing him hands control back to you until you tap the
// "ride" toggle again.

export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
  appId?: string;
  title?: string;
}

let riding = false; // OFF by default — opt in via the 📌 toggle. (Auto-riding
// chased panel coords on launch and made him jump around hunting a perch.)
let freeMode = false; // true after the user grabs him off the panels
let lastRect: PanelRect | null = null;
let lastRidApp: string | null = null;
let followTarget: { x: number; y: number } | null = null;
let followCur: { x: number; y: number } | null = null;
let followRaf = 0;
const FOOT_INSET = 84; // px his feet overlap down onto the panel's top edge

export function isRidingPanels(): boolean {
  return riding && !freeMode;
}

export function setRidePanels(on: boolean): void {
  riding = on;
  if (on) {
    freeMode = false;
    if (lastRect) onPanelRect(lastRect); // re-perch on the current panel now
  } else {
    stopFollow();
  }
}

// Called the moment a real drag begins — the user is taking manual control.
function detachForDrag(): void {
  freeMode = true;
  followCur = null; // re-read his real position next time he re-attaches
  stopFollow();
}

export function onPanelRect(rect: PanelRect | null): void {
  if (!canDragCompanion()) return;
  lastRect = rect;
  dbg(
    `panel ${rect ? rect.appId + " " + rect.x + "," + rect.y : "null"} riding=${riding} free=${freeMode}`
  );
  if (!riding || freeMode || !rect) return;

  // New panel focused → sit down on it and comment.
  if (rect.appId && rect.appId !== lastRidApp) {
    lastRidApp = rect.appId;
    useCharacter.getState().onRidePanel(rect.appId);
  }

  const w = BASE_W * scale;
  const h = BASE_H * scale;
  followTarget = {
    x: rect.x + rect.w / 2 - w / 2,
    y: rect.y - h + FOOT_INSET,
  };
  startFollow();
}

function startFollow(): void {
  if (followRaf) return;
  const b = bridge();
  if (!b?.companionSetPos || !b.companionGetBounds) return;
  if (!followCur) {
    void b.companionGetBounds().then((bn) => {
      if (bn) followCur = { x: bn.x, y: bn.y };
    });
  }
  let last = performance.now();
  const step = () => {
    if (!riding || freeMode) {
      stopFollow();
      return;
    }
    const now = performance.now();
    const k = Math.min(((now - last) / 16.67) * 0.2, 1); // critically-ish damped
    last = now;
    if (followTarget && followCur) {
      followCur.x += (followTarget.x - followCur.x) * k;
      followCur.y += (followTarget.y - followCur.y) * k;
      void b.companionSetPos!(followCur.x, followCur.y);
    }
    followRaf = requestAnimationFrame(step);
  };
  followRaf = requestAnimationFrame(step);
}

function stopFollow(): void {
  if (followRaf) cancelAnimationFrame(followRaf);
  followRaf = 0;
}
