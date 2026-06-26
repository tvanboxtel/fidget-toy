// "Check for updates" support for the control center.
//
// We deliberately do NOT use a real auto-updater: that needs code-signing keys
// we don't have. Instead we ask GitHub for the latest release tag, compare it
// to the running version, and — if there's a newer one — point the user at the
// download page. Re-running the install one-liner there gets them the update.

import { invoke } from "@tauri-apps/api/core";

const REPO = "tvanboxtel/fidget-toy";
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

export type UpdateCheck =
  | { state: "current"; version: string }
  | { state: "available"; version: string; latest: string }
  | { state: "error"; message: string };

/** Parse "v0.1.3" / "0.1.3" into comparable numeric parts. */
function parseVersion(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

/** True if `latest` is a strictly higher semver than `current`. */
function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Compare the running version against the latest GitHub release. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const current = await invoke<string>("current_version");
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    const data = (await res.json()) as { tag_name?: string };
    const latest = (data.tag_name ?? "").trim();
    if (!latest) throw new Error("no release tag found");

    return isNewer(latest, current)
      ? { state: "available", version: current, latest }
      : { state: "current", version: current };
  } catch (e) {
    return {
      state: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Open the releases page in the user's default browser. */
export function openReleasesPage(): Promise<void> {
  return invoke("open_url", { url: RELEASES_URL });
}
