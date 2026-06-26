// Shared settings model used by both the toy (main) and the control center
// (settings) windows.
//
// Persistence: both windows share the same webview origin, so localStorage is
// shared between them. We persist there and broadcast live changes over a Tauri
// event so the toy updates in real time while you drag a slider.

export type Settings = {
  radius: number; // ball radius (px)
  gravity: number; // px/s^2
  stringLen: number; // resting string length (px)
  stringK: number; // string stiffness
  restitution: number; // wall bounciness when free (0..1)
  batForce: number; // fraction of cursor speed transferred when batting
  color: string; // ball base color (hex)
};

export const DEFAULTS: Settings = {
  radius: 44,
  gravity: 1500,
  stringLen: 260,
  stringK: 180,
  restitution: 0.5,
  batForce: 0.65,
  color: "#ff5252",
};

// Per-setting UI metadata for the control center (label, slider range, step).
export type FieldMeta = {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
};

export const SLIDERS: FieldMeta[] = [
  { key: "radius", label: "Ball size", min: 20, max: 90, step: 1 },
  { key: "gravity", label: "Gravity", min: 200, max: 3500, step: 50 },
  { key: "stringLen", label: "String length", min: 100, max: 500, step: 10 },
  { key: "stringK", label: "String stretchiness", min: 60, max: 400, step: 10 },
  { key: "restitution", label: "Bounciness", min: 0, max: 0.9, step: 0.05 },
  { key: "batForce", label: "Bat strength", min: 0.1, max: 1.2, step: 0.05 },
];

const STORAGE_KEY = "fidget-settings";
export const SETTINGS_EVENT = "settings-changed";

/** Load settings from localStorage, falling back to (and filling in) defaults. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* corrupt or unavailable — use defaults */
  }
  return { ...DEFAULTS };
}

/** Persist settings to localStorage. */
export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota/availability errors */
  }
}
