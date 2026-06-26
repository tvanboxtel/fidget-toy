#!/usr/bin/env bash
# Fidget Toy installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/tvanboxtel/fidget-toy/main/install.sh | bash
#
# Downloads the latest release asset for your OS/arch and installs it. On macOS
# it also strips the Gatekeeper quarantine flag so the app opens with a normal
# double-click (no right-click dance).
set -euo pipefail

REPO="tvanboxtel/fidget-toy"
API="https://api.github.com/repos/${REPO}/releases/latest"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }

fail() { red "✘ $*"; exit 1; }

bold "🔴 Installing Fidget Toy…"

OS="$(uname -s)"
ARCH="$(uname -m)"

# Pull the list of downloadable asset URLs from the latest release.
assets="$(curl -fsSL "$API" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')" \
  || fail "Couldn't reach GitHub. Are you online?"

[ -n "$assets" ] || fail "No published release found yet at https://github.com/${REPO}/releases"

# Pick the right asset for this machine.
pick() { printf '%s\n' "$assets" | grep -iE "$1" | head -n1; }

case "$OS" in
  Darwin)
    if [ "$ARCH" = "arm64" ]; then
      url="$(pick 'aarch64.*\.dmg$|\.dmg$')"
    else
      url="$(pick 'x64.*\.dmg$|x86_64.*\.dmg$|\.dmg$')"
    fi
    [ -n "$url" ] || fail "No macOS (.dmg) build found in the latest release."

    tmp="$(mktemp -d)"
    mnt="$tmp/mnt"
    mkdir -p "$mnt"
    trap 'hdiutil detach "$mnt" -quiet 2>/dev/null || true; rm -rf "$tmp"' EXIT
    info "Downloading $(basename "$url")…"
    curl -fSL "$url" -o "$tmp/app.dmg"

    info "Mounting…"
    # Mount to a path we control instead of parsing hdiutil's output (which
    # -quiet suppresses, and pipefail would then abort on). -nobrowse keeps it
    # out of Finder.
    hdiutil attach "$tmp/app.dmg" -nobrowse -mountpoint "$mnt" >/dev/null \
      || fail "Couldn't mount the disk image."

    app="$(find "$mnt" -maxdepth 1 -name '*.app' | head -n1)"
    [ -n "$app" ] || fail "No .app found inside the disk image."

    info "Copying to /Applications…"
    rm -rf "/Applications/$(basename "$app")"
    cp -R "$app" /Applications/

    # Remove the quarantine flag so it opens without the scary warning.
    xattr -dr com.apple.quarantine "/Applications/$(basename "$app")" 2>/dev/null || true

    bold "✅ Done! Open it from your Applications folder or Launchpad."
    ;;

  Linux)
    url="$(pick '\.AppImage$')"
    [ -n "$url" ] || fail "No Linux (.AppImage) build found in the latest release."

    dest="${HOME}/.local/bin"
    mkdir -p "$dest"
    target="${dest}/fidget-toy.AppImage"

    info "Downloading $(basename "$url")…"
    curl -fSL "$url" -o "$target"
    chmod +x "$target"

    bold "✅ Done! Installed to: $target"
    case ":$PATH:" in
      *":$dest:"*) info "Run it any time with:  fidget-toy.AppImage" ;;
      *)           info "Run it with:  $target"
                   info "(Add $dest to your PATH to launch it by name.)" ;;
    esac
    ;;

  *)
    fail "Unsupported OS: $OS. On Windows, use the PowerShell installer instead (see the README)."
    ;;
esac
