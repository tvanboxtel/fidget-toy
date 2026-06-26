import { emit } from "@tauri-apps/api/event";
import {
  DEFAULTS,
  SLIDERS,
  SETTINGS_EVENT,
  loadSettings,
  saveSettings,
} from "./settings";

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
