import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SETTINGS_EVENT, loadSettings, type Settings } from "./settings";

// Click-through strategy differs by platform:
//  - Linux:        GTK input shape (set_input_region) — Wayland can't report
//                  the global cursor, so we restrict the window's input region.
//  - macOS/Win:    poll the global cursor + toggle setIgnoreCursorEvents.
// We detect Linux at runtime; everything else uses the cursor-poll path.
const IS_LINUX = navigator.userAgent.includes("Linux");
const appWindow = getCurrentWindow();

// ---------------------------------------------------------------------------
// User-tunable settings (driven by the control center). Loaded from shared
// storage at startup; updated live when the settings window broadcasts.
// ---------------------------------------------------------------------------
let settings: Settings = loadSettings();

// Derived helpers for values built from settings.
const breakLen = () => settings.stringLen * 1.85; // pull past this → rope snaps
const reattachLen = () => settings.stringLen * 0.9; // release within → re-tie

// ---------------------------------------------------------------------------
// Fixed tuning — not exposed in the UI (internal feel constants).
// ---------------------------------------------------------------------------
const GRAB_PAD = 22; // extra clickable margin around the ball (forgiving grab)
const STRING_DAMP = 10; // damping on the stretch (1/s) — kills the boing
const FRICTION = 0.99; // air/rolling damping per frame
const MAX_FLING = 4000; // clamp release velocity (px/s)
const BAT_MAX = 1900; // clamp a single bat's resulting speed (px/s)
const BAT_MIN_SPEED = 250; // ignore slow hovers (px/s) so resting near the ball
//                            doesn't nudge it
const SQUASH_DECAY = 9; // how fast squash eases back (higher = snappier)
const SQUASH_GAIN = 0.0016; // squash amount per px/s of impact speed

// ---------------------------------------------------------------------------
// Canvas setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let W = 0;
let H = 0;
let dpr = window.devicePixelRatio || 1;

// The string's anchor point (top-center of the screen). The ball hangs from it.
let anchorX = 0;
let anchorY = 0;

function resize() {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  anchorX = W / 2;
  anchorY = 0;
}
resize();
window.addEventListener("resize", resize);

// ---------------------------------------------------------------------------
// Physics state — the ball hangs from the anchor on a string.
// ---------------------------------------------------------------------------
let x = W / 2;
let y = settings.stringLen;
let vx = 0;
let vy = 0;

// Whether the ball is tied to the string. When false the rope has snapped and
// the ball is a free bouncing body until you drag it back up to the anchor.
let attached = true;

// Squash-and-stretch: `squash` 0 = round, >0 = flattened along impact axis.
let squash = 0;
let squashAngle = 0; // radians; axis the ball is compressed along

// ---------------------------------------------------------------------------
// Pointer / drag state
// ---------------------------------------------------------------------------
let dragging = false;
let grabOffsetX = 0;
let grabOffsetY = 0;
// Recent pointer samples for computing fling velocity on release.
type Sample = { x: number; y: number; t: number };
let samples: Sample[] = [];

function pushSample(px: number, py: number, t: number) {
  samples.push({ x: px, y: py, t });
  // Keep ~80ms of history.
  while (samples.length > 2 && t - samples[0].t > 80) samples.shift();
}

function flingVelocity(): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const a = samples[0];
  const b = samples[samples.length - 1];
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0) return { vx: 0, vy: 0 };
  let fvx = (b.x - a.x) / dt;
  let fvy = (b.y - a.y) / dt;
  const speed = Math.hypot(fvx, fvy);
  if (speed > MAX_FLING) {
    const s = MAX_FLING / speed;
    fvx *= s;
    fvy *= s;
  }
  return { vx: fvx, vy: fvy };
}

// Hit test for grabbing. `pad` widens the catch radius so you don't have to be
// pixel-perfect on the moving ball. Batting passes pad=0 for a tight test.
function overBall(px: number, py: number, pad = GRAB_PAD): boolean {
  return Math.hypot(px - x, py - y) <= settings.radius + pad;
}

// ---------------------------------------------------------------------------
// Click-through via input region. Rather than toggling whole-window cursor
// ignoring (which needs the global cursor position — unavailable on Wayland),
// we restrict the window's input shape to just the ball's bounding box. Empty
// space passes clicks through; the ball stays grabbable. See BUILD_PLAN §6.
//
// We push the region every frame the ball's integer bbox changes. GTK input
// shapes use LOGICAL (device-independent) pixels — the same space as DOM
// coordinates — so we do NOT multiply by devicePixelRatio here.
// ---------------------------------------------------------------------------
let lastRegion = "";

// Linux path: restrict the window's GTK input shape to the ball's bounding box.
function updateInputRegion() {
  let left: number;
  let top: number;
  let w: number;
  let h: number;

  if (dragging) {
    // While dragging, the cursor can outrun the ball; if it crosses into a
    // pass-through area the compositor stops delivering events and the drag
    // dies. Claim the whole window for the duration of the drag.
    left = 0;
    top = 0;
    w = W;
    h = H;
  } else {
    // At rest, only the ball (plus a forgiving grab margin) is interactive so
    // clicks pass through elsewhere.
    const pad = GRAB_PAD;
    left = Math.floor(x - settings.radius - pad);
    top = Math.floor(y - settings.radius - pad);
    w = Math.ceil(settings.radius * 2 + pad * 2);
    h = w;
  }

  const key = `${left},${top},${w},${h}`;
  if (key === lastRegion) return;
  lastRegion = key;
  invoke("set_input_region", { x: left, y: top, w, h }).catch(
    () => {
      // Window may not be realized on the very first frames; retry next change.
      lastRegion = "";
    },
  );
}

// macOS/Windows path: the whole window ignores cursor events by default, so
// clicks fall through to windows behind it (e.g. the settings panel). We poll
// the global cursor and disable ignore only while it's over the ball — and
// while dragging, so a fast drag doesn't slip off and drop the ball.
let ignoring: boolean | null = null; // current OS state; null = not yet set

async function setIgnore(ignore: boolean) {
  if (ignore === ignoring) return;
  ignoring = ignore;
  try {
    await appWindow.setIgnoreCursorEvents(ignore);
  } catch {
    ignoring = null; // retry next tick
  }
}

async function updateCursorClickThrough() {
  if (dragging) {
    await setIgnore(false);
    return;
  }
  try {
    const [cx, cy] = await invoke<[number, number]>("cursor_pos");
    await setIgnore(!overBall(cx, cy));
  } catch {
    /* window not ready yet */
  }
}

// Dispatch to the right strategy each frame.
function updateClickThrough() {
  if (IS_LINUX) updateInputRegion();
  else void updateCursorClickThrough();
}

// ---------------------------------------------------------------------------
// Pointer events (only fire when the window is NOT ignoring cursor events,
// i.e. when we're over the ball or dragging).
// ---------------------------------------------------------------------------
canvas.addEventListener("pointerdown", (e) => {
  if (!overBall(e.clientX, e.clientY)) return;
  dragging = true;
  grabOffsetX = x - e.clientX;
  grabOffsetY = y - e.clientY;
  vx = 0;
  vy = 0;
  samples = [];
  pushSample(e.clientX, e.clientY, e.timeStamp);
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add("grabbing");
  wake();
});

// Previous hover sample, for computing cursor speed when batting the ball.
let hoverPX = 0;
let hoverPY = 0;
let hoverPT = 0;

canvas.addEventListener("pointermove", (e) => {
  if (dragging) {
    x = e.clientX + grabOffsetX;
    y = e.clientY + grabOffsetY;
    pushSample(e.clientX, e.clientY, e.timeStamp);

    // Pull hard enough and the rope snaps.
    if (attached && Math.hypot(x - anchorX, y - anchorY) > breakLen()) {
      attached = false;
      const ang = Math.atan2(y - anchorY, x - anchorX);
      impact(900, ang); // a satisfying snap squash
    }
    return;
  }

  // Not dragging: the input region is just the ball, so a move here means the
  // cursor is sweeping across it. We bat it with the cursor's velocity.
  //
  // A fast sweep produces very few events inside the tiny ball region, and the
  // first one's time delta is stale (no events fire while outside the region).
  // So we read the COALESCED events — the browser's high-frequency sub-frame
  // input samples bundled into this one event — which give a reliable velocity
  // even from a single sweep across the ball.
  const coalesced = e.getCoalescedEvents?.() ?? [];
  const pts =
    coalesced.length > 1
      ? coalesced.map((c) => ({ x: c.clientX, y: c.clientY, t: c.timeStamp }))
      : [
          { x: hoverPX, y: hoverPY, t: hoverPT },
          { x: e.clientX, y: e.clientY, t: e.timeStamp },
        ];

  let bestSpeed = 0;
  let bestVX = 0;
  let bestVY = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dt = (b.t - a.t) / 1000;
    if (a.t <= 0 || dt <= 0 || dt > 0.1) continue;
    // Only count segments whose endpoint actually touches the ball (tight).
    if (!overBall(b.x, b.y, 0)) continue;
    const cvx = (b.x - a.x) / dt;
    const cvy = (b.y - a.y) / dt;
    const speed = Math.hypot(cvx, cvy);
    if (speed > bestSpeed) {
      bestSpeed = speed;
      bestVX = cvx;
      bestVY = cvy;
    }
  }

  if (bestSpeed > BAT_MIN_SPEED) {
    vx += bestVX * settings.batForce;
    vy += bestVY * settings.batForce;
    const s = Math.hypot(vx, vy);
    if (s > BAT_MAX) {
      vx *= BAT_MAX / s;
      vy *= BAT_MAX / s;
    }
    impact(bestSpeed * settings.batForce, Math.atan2(bestVY, bestVX));
    wake();
  }

  hoverPX = e.clientX;
  hoverPY = e.clientY;
  hoverPT = e.timeStamp;
});

function endDrag(e: PointerEvent) {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove("grabbing");
  pushSample(e.clientX, e.clientY, e.timeStamp);
  const f = flingVelocity();
  vx = f.vx;
  vy = f.vy;

  // Dropped the loose ball back up near the anchor? Re-tie the rope.
  if (!attached && Math.hypot(x - anchorX, y - anchorY) <= reattachLen()) {
    attached = true;
  }
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    /* no-op */
  }
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

// Lighten (amount > 0) or darken (amount < 0) a #rrggbb color toward white/black.
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xff5252;
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `rgb(${r}, ${g}, ${b})`;
}

// ---------------------------------------------------------------------------
// Impact handling — trigger squash along a given axis.
// ---------------------------------------------------------------------------
function impact(speed: number, angle: number) {
  const s = Math.min(0.6, speed * SQUASH_GAIN);
  if (s > squash) {
    squash = s;
    squashAngle = angle;
  }
}

// ---------------------------------------------------------------------------
// Simulation step — a ball on an elastic string (pendulum). Gravity pulls it
// down; the string is a one-sided damped spring: slack (no force) within
// STRING_LEN of the anchor, pulling back smoothly when stretched beyond it.
// Releasing a stretched ball springs it back and swings — no instant snap.
// ---------------------------------------------------------------------------
function step(dt: number) {
  if (!dragging) {
    vy += settings.gravity * dt;

    if (attached) {
      // Elastic string: a one-sided damped spring from the anchor.
      const dx = x - anchorX;
      const dy = y - anchorY;
      const dist = Math.hypot(dx, dy) || 0.0001;

      if (dist > settings.stringLen) {
        const nx = dx / dist;
        const ny = dy / dist;
        const stretch = dist - settings.stringLen;

        // Spring pulls inward, proportional to how far it's overstretched.
        vx -= settings.stringK * stretch * nx * dt;
        vy -= settings.stringK * stretch * ny * dt;

        // Damp only the outward (radial) velocity so the spring doesn't boing
        // forever; tangential swing is preserved. Squash on a hard yank-back.
        const radial = vx * nx + vy * ny;
        if (radial < -300) impact(-radial, Math.atan2(ny, nx));
        vx -= STRING_DAMP * radial * nx * dt;
        vy -= STRING_DAMP * radial * ny * dt;
      }
    }

    x += vx * dt;
    y += vy * dt;

    if (!attached) {
      // Free ball: bounce off the window edges.
      const r = settings.radius;
      const e = settings.restitution;
      if (x - r < 0) {
        x = r;
        if (vx < 0) impact(Math.abs(vx), 0);
        vx = -vx * e;
      }
      if (x + r > W) {
        x = W - r;
        if (vx > 0) impact(Math.abs(vx), 0);
        vx = -vx * e;
      }
      if (y - r < 0) {
        y = r;
        if (vy < 0) impact(Math.abs(vy), Math.PI / 2);
        vy = -vy * e;
      }
      if (y + r > H) {
        y = H - r;
        if (vy > 0) impact(Math.abs(vy), Math.PI / 2);
        vy = -vy * e;
      }
    }

    vx *= FRICTION;
    vy *= FRICTION;
  }

  // Ease squash back toward 0.
  squash -= squash * SQUASH_DECAY * dt;
  if (squash < 0.001) squash = 0;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function draw() {
  ctx.clearRect(0, 0, W, H);

  const r = settings.radius;

  // The string: a line from the anchor to the ball's surface (only when tied).
  if (attached) {
    const dx = x - anchorX;
    const dy = y - anchorY;
    const d = Math.hypot(dx, dy) || 1;
    const bx = x - (dx / d) * r; // attach point on the ball's surface
    const by = y - (dy / d) * r;
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.lineTo(bx, by);
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(30, 30, 30, 0.85)";
    ctx.stroke();
  } else {
    // Snapped: a short frayed stub dangling from the anchor.
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.lineTo(anchorX, anchorY + settings.stringLen * 0.12);
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(30, 30, 30, 0.6)";
    ctx.stroke();
  }

  // Scale factors for squash-and-stretch (volume-preserving-ish).
  const sx = 1 - squash;
  const sy = 1 + squash;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(squashAngle);
  ctx.scale(sx, sy);

  // Soft drop shadow.
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;

  // Glossy radial fill, lit from the upper-left, built from the chosen color.
  const grad = ctx.createRadialGradient(
    -r * 0.3,
    -r * 0.4,
    r * 0.1,
    0,
    0,
    r,
  );
  grad.addColorStop(0, shade(settings.color, 0.5));
  grad.addColorStop(0.5, settings.color);
  grad.addColorStop(1, shade(settings.color, -0.35));

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Specular highlight (drawn without a shadow).
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.arc(-r * 0.32, -r * 0.36, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fill();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Live settings: apply broadcasts from the control center, and redraw/wake so
// changes (size, color, gravity…) take effect immediately even while at rest.
// ---------------------------------------------------------------------------
listen<Settings>(SETTINGS_EVENT, (e) => {
  settings = { ...settings, ...e.payload };
  lastRegion = ""; // radius may have changed → force an input-region refresh
  wake();
});

// ---------------------------------------------------------------------------
// Main loop with idle-sleep. An always-running desktop toy shouldn't burn CPU
// drawing a ball that's been resting for minutes, so we stop simulating once
// everything has settled and resume on any interaction (pointer or settings).
// ---------------------------------------------------------------------------
let last = performance.now();
let idleFrames = 0; // consecutive nearly-still frames
const SLEEP_AFTER = 30; // ~0.5s of stillness before sleeping

// Anything that moves the ball calls this to guarantee the loop is awake.
function wake() {
  idleFrames = 0;
}

function nearlyStill(): boolean {
  // Asleep only when not being dragged, barely moving, and no squash to ease.
  return (
    !dragging &&
    Math.hypot(vx, vy) < 4 &&
    squash < 0.002 &&
    // A free ball resting on the floor is still; a free ball mid-air is not.
    (attached || y + settings.radius >= H - 1)
  );
}

function frame(now: number) {
  // Clamp dt so a stall (e.g. tab throttle) doesn't fling the ball off-screen.
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;

  idleFrames = nearlyStill() ? idleFrames + 1 : 0;

  if (idleFrames < SLEEP_AFTER) {
    step(dt);
    draw();
  }
  // Click-through must keep running even while the ball sleeps, so the cursor
  // poll (macOS/Win) can still detect hover over a resting ball and wake it.
  updateClickThrough();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
