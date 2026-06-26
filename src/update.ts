// Self-update for the control center.
//
// Uses Tauri's updater plugin: it fetches our signed `latest.json` manifest
// from GitHub, and if a newer signed bundle exists, downloads and installs it
// in place, then we relaunch. Bundles are verified against the public key
// baked into tauri.conf.json, so only releases we signed can be installed.
//
// Caveat by platform: Windows + macOS .dmg and the Linux AppImage self-update;
// .deb/.rpm and from-source (Arch) installs do not — for those, the check
// still reports "update available" and we fall back to the download page.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";

const REPO = "tvanboxtel/fidget-toy";
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

export type UpdateCheck =
  | { state: "current"; version: string }
  | { state: "available"; version: string; latest: string; update: Update }
  | { state: "error"; message: string };

/** Ask the updater whether a newer signed release is available. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const current = await invoke<string>("current_version");
  try {
    const update = await check();
    if (update) {
      return {
        state: "available",
        version: current,
        latest: update.version,
        update,
      };
    }
    return { state: "current", version: current };
  } catch (e) {
    return {
      state: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Download + install the update, reporting progress, then relaunch into the
 * new version. Resolves only if something goes wrong (otherwise the app
 * restarts and this never returns).
 */
export async function installUpdate(
  update: Update,
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(downloaded, total);
        break;
      case "Finished":
        onProgress?.(total ?? downloaded, total);
        break;
    }
  });

  await relaunch();
}

/** Open the releases page in the user's default browser (fallback path). */
export function openReleasesPage(): Promise<void> {
  return invoke("open_url", { url: RELEASES_URL });
}
