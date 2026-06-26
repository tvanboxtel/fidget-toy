import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Tuning — the "feel" lives here. See BUILD_PLAN section 5.
// ---------------------------------------------------------------------------
const RADIUS = 44; // ball radius in CSS px
const GRAB_PAD = 22; // extra clickable margin around the ball (forgiving grab)
const GRAVITY = 1500; // px/s^2
const STRING_LEN = 260; // resting length of the string (px)
const STRING_K = 180; // string spring stiffness (1/s^2) when stretched
const STRING_DAMP = 10; // damping on the stretch (1/s) — kills the boing
const BREAK_LEN = STRING_LEN * 1.85; // stretch past this and the rope snaps
const REATTACH_LEN = STRING_LEN * 0.9; // release within this of anchor to re-tie
const RESTITUTION = 0.5; // wall bounciness once the ball is free
const FRICTION = 0.99; // air/rolling damping per frame
const MAX_FLING = 4000; // clamp release velocity (px/s)
const BAT_FORCE = 0.65; // fraction of cursor speed transferred when batting
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
let y = STRING_LEN;
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
  return Math.hypot(px - x, py - y) <= RADIUS + pad;
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
    left = Math.floor(x - RADIUS - pad);
    top = Math.floor(y - RADIUS - pad);
    w = Math.ceil(RADIUS * 2 + pad * 2);
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
    if (attached && Math.hypot(x - anchorX, y - anchorY) > BREAK_LEN) {
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
    vx += bestVX * BAT_FORCE;
    vy += bestVY * BAT_FORCE;
    const s = Math.hypot(vx, vy);
    if (s > BAT_MAX) {
      vx *= BAT_MAX / s;
      vy *= BAT_MAX / s;
    }
    impact(bestSpeed * BAT_FORCE, Math.atan2(bestVY, bestVX));
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
  if (!attached && Math.hypot(x - anchorX, y - anchorY) <= REATTACH_LEN) {
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
    vy += GRAVITY * dt;

    if (attached) {
      // Elastic string: a one-sided damped spring from the anchor.
      const dx = x - anchorX;
      const dy = y - anchorY;
      const dist = Math.hypot(dx, dy) || 0.0001;

      if (dist > STRING_LEN) {
        const nx = dx / dist;
        const ny = dy / dist;
        const stretch = dist - STRING_LEN;

        // Spring pulls inward, proportional to how far it's overstretched.
        vx -= STRING_K * stretch * nx * dt;
        vy -= STRING_K * stretch * ny * dt;

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
      if (x - RADIUS < 0) {
        x = RADIUS;
        if (vx < 0) impact(Math.abs(vx), 0);
        vx = -vx * RESTITUTION;
      }
      if (x + RADIUS > W) {
        x = W - RADIUS;
        if (vx > 0) impact(Math.abs(vx), 0);
        vx = -vx * RESTITUTION;
      }
      if (y - RADIUS < 0) {
        y = RADIUS;
        if (vy < 0) impact(Math.abs(vy), Math.PI / 2);
        vy = -vy * RESTITUTION;
      }
      if (y + RADIUS > H) {
        y = H - RADIUS;
        if (vy > 0) impact(Math.abs(vy), Math.PI / 2);
        vy = -vy * RESTITUTION;
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

  // The string: a line from the anchor to the ball's surface (only when tied).
  if (attached) {
    const dx = x - anchorX;
    const dy = y - anchorY;
    const d = Math.hypot(dx, dy) || 1;
    const bx = x - (dx / d) * RADIUS; // attach point on the ball's surface
    const by = y - (dy / d) * RADIUS;
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
    ctx.lineTo(anchorX, anchorY + STRING_LEN * 0.12);
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

  // Glossy radial fill.
  const grad = ctx.createRadialGradient(
    -RADIUS * 0.3,
    -RADIUS * 0.4,
    RADIUS * 0.1,
    0,
    0,
    RADIUS,
  );
  grad.addColorStop(0, "#ff8a8a");
  grad.addColorStop(0.5, "#ff5252");
  grad.addColorStop(1, "#c62828");

  ctx.beginPath();
  ctx.arc(0, 0, RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Specular highlight (drawn without a shadow).
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.arc(-RADIUS * 0.32, -RADIUS * 0.36, RADIUS * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fill();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now: number) {
  // Clamp dt so a stall (e.g. tab throttle) doesn't fling the ball off-screen.
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;

  step(dt);
  draw();
  updateInputRegion();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
