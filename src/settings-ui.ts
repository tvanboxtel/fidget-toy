import { emit } from "@tauri-apps/api/event";
import {
  DEFAULTS,
  SLIDERS,
  SETTINGS_EVENT,
  loadSettings,
  saveSettings,
} from "./settings";
import {
  checkForUpdate,
  installUpdate,
  openReleasesPage,
  type UpdateCheck,
} from "./update";

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
// Check for updates. Tauri's updater installs the new signed bundle in place
// and relaunches — one click, no terminal. If the install fails (e.g. a target
// that can't self-update, like .deb/.rpm or a from-source build), we fall back
// to opening the download page.
// ---------------------------------------------------------------------------
const updateBtn = document.getElementById("check-update") as HTMLButtonElement;
const updateStatus = document.getElementById("update-status")!;

// What the next click does. "check" → look for an update; "install" → download
// + install the one we found; "open" → fallback to the download page.
let mode: "check" | "install" | "open" = "check";
let pending: Extract<UpdateCheck, { state: "available" }> | null = null;

function setStatus(cls: string, text: string) {
  updateStatus.className = `update-status${cls ? " " + cls : ""}`;
  updateStatus.textContent = text;
}

updateBtn.addEventListener("click", async () => {
  if (mode === "open") {
    openReleasesPage();
    return;
  }

  if (mode === "install" && pending) {
    updateBtn.disabled = true;
    setStatus("available", "Downloading…");
    try {
      await installUpdate(pending.update, (done, total) => {
        const pct = total ? Math.round((done / total) * 100) : null;
        setStatus("available", pct === null ? "Downloading…" : `Downloading… ${pct}%`);
      });
      // On success the app relaunches; we won't get here.
    } catch (e) {
      // Can't self-update on this target — send them to the download page.
      mode = "open";
      updateBtn.disabled = false;
      updateBtn.textContent = "Open download page →";
      setStatus(
        "error",
        `Couldn't auto-install (${e instanceof Error ? e.message : e}). Get it manually:`,
      );
    }
    return;
  }

  // mode === "check"
  updateBtn.disabled = true;
  setStatus("", "Checking…");

  const result = await checkForUpdate();
  updateBtn.disabled = false;

  if (result.state === "available") {
    mode = "install";
    pending = result;
    updateBtn.textContent = `Install v${result.latest} & restart`;
    setStatus("available", `Update available (you have v${result.version}).`);
  } else if (result.state === "current") {
    setStatus("ok", `You're up to date (v${result.version}).`);
  } else {
    setStatus("error", `Couldn't check: ${result.message}`);
  }
});
