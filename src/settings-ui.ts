import { emit } from "@tauri-apps/api/event";
import {
  DEFAULTS,
  SLIDERS,
  SETTINGS_EVENT,
  loadSettings,
  saveSettings,
} from "./settings";
import { checkForUpdate, openReleasesPage } from "./update";

let settings = loadSettings();

const controls = document.getElementById("controls")!;
const colorInput = document.getElementById("color") as HTMLInputElement;
const resetBtn = document.getElementById("reset")!;

// Persist + broadcast to the toy window so it updates live.
function commit() {
  saveSettings(settings);
  emit(SETTINGS_EVENT, settings);
}

// Show a tidy value next to each slider (integers vs. 2-decimal fractions).
function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

// Build a labeled slider per field and keep a setter to refresh its UI on reset.
const refreshers: Array<() => void> = [];

for (const f of SLIDERS) {
  const wrap = document.createElement("div");
  wrap.className = "field";

  const head = document.createElement("div");
  head.className = "field-head";
  const label = document.createElement("label");
  label.textContent = f.label;
  label.htmlFor = `slider-${f.key}`;
  const val = document.createElement("span");
  val.className = "val";
  head.append(label, val);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = `slider-${f.key}`;
  slider.min = String(f.min);
  slider.max = String(f.max);
  slider.step = String(f.step);

  const sync = () => {
    const v = settings[f.key] as number;
    slider.value = String(v);
    val.textContent = fmt(v);
  };
  sync();
  refreshers.push(sync);

  slider.addEventListener("input", () => {
    const v = parseFloat(slider.value);
    (settings[f.key] as number) = v;
    val.textContent = fmt(v);
    commit();
  });

  wrap.append(head, slider);
  controls.appendChild(wrap);
}

// Color picker.
colorInput.value = settings.color;
colorInput.addEventListener("input", () => {
  settings.color = colorInput.value;
  commit();
});

// Reset to defaults.
resetBtn.addEventListener("click", () => {
  settings = { ...DEFAULTS };
  refreshers.forEach((r) => r());
  colorInput.value = settings.color;
  commit();
});

// ---------------------------------------------------------------------------
// Check for updates. We don't auto-update (no code-signing keys); we just tell
// the user a newer version exists and the button then opens the download page.
// ---------------------------------------------------------------------------
const updateBtn = document.getElementById("check-update") as HTMLButtonElement;
const updateStatus = document.getElementById("update-status")!;

// Tracks whether clicking the button checks (default) or opens the download
// page (after an update has been found).
let openOnClick = false;

updateBtn.addEventListener("click", async () => {
  if (openOnClick) {
    openReleasesPage();
    return;
  }

  updateBtn.disabled = true;
  updateStatus.className = "update-status";
  updateStatus.textContent = "Checking…";

  const result = await checkForUpdate();
  updateBtn.disabled = false;

  if (result.state === "available") {
    openOnClick = true;
    updateBtn.textContent = `Get ${result.latest} →`;
    updateStatus.className = "update-status available";
    updateStatus.textContent = `Update available (you have v${result.version}).`;
  } else if (result.state === "current") {
    updateStatus.className = "update-status ok";
    updateStatus.textContent = `You're up to date (v${result.version}).`;
  } else {
    updateStatus.className = "update-status error";
    updateStatus.textContent = `Couldn't check: ${result.message}`;
  }
});
