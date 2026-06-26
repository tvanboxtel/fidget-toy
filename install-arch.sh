#!/usr/bin/env bash
# Fidget Toy installer for Arch Linux (and derivatives).
#
#   curl -fsSL https://raw.githubusercontent.com/tvanboxtel/fidget-toy/main/install-arch.sh | bash
#
# The prebuilt AppImage bundles an Ubuntu-built WebKit that fails to init EGL on
# many Arch + Wayland + GPU setups. The robust fix is to build from source so it
# links *your* system's WebKit. This installs the build deps (one sudo prompt),
# compiles, and drops the binary + a launcher into your user dirs.
set -euo pipefail

REPO="https://github.com/tvanboxtel/fidget-toy.git"
SRC="${HOME}/.cache/fidget-toy-src"
BIN_DIR="${HOME}/.local/bin"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/128x128/apps"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
fail() { printf '\033[31m✘ %s\033[0m\n' "$*"; exit 1; }

command -v pacman >/dev/null || fail "This installer is for Arch-based distros (no pacman found)."

bold "🔴 Installing Fidget Toy (building from source for your system)…"

# 1. Build dependencies. We only install a package if the tool it provides is
#    missing — this avoids conflicts when you already have node/rust/pnpm from a
#    different package (e.g. nodejs-lts-* instead of nodejs, or rustup).
info "Checking build dependencies…"
pkgs=(base-devel git webkit2gtk-4.1 libayatana-appindicator librsvg)
command -v node  >/dev/null || pkgs+=(nodejs)
command -v pnpm  >/dev/null || pkgs+=(pnpm)
command -v cargo >/dev/null || pkgs+=(rust)

info "Installing: ${pkgs[*]} (you'll be asked for your password)…"
sudo pacman -S --needed --noconfirm "${pkgs[@]}" \
  || fail "Failed to install dependencies."

# 2. Get the source (fresh clone, or update an existing one).
if [ -d "$SRC/.git" ]; then
  info "Updating existing source in $SRC…"
  git -C "$SRC" pull --ff-only
else
  info "Cloning source into $SRC…"
  rm -rf "$SRC"
  git clone --depth 1 "$REPO" "$SRC"
fi

cd "$SRC"

# 3. Build. This compiles Rust + the frontend; first run takes a few minutes.
info "Installing frontend packages…"
pnpm install --silent
info "Building (this can take a few minutes the first time)…"
pnpm tauri build --bundles deb >/dev/null

BIN="$SRC/src-tauri/target/release/fidget-toy"
[ -x "$BIN" ] || fail "Build finished but the binary wasn't found at $BIN."

# 4. Install the binary, an icon, and a menu entry.
mkdir -p "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"
install -m755 "$BIN" "$BIN_DIR/fidget-toy"

icon_src="$SRC/src-tauri/icons/128x128.png"
[ -f "$icon_src" ] && install -m644 "$icon_src" "$ICON_DIR/fidget-toy.png"

cat > "$DESKTOP_DIR/fidget-toy.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Fidget Toy
Comment=A little red ball on a string for your desktop
Exec=$BIN_DIR/fidget-toy
Icon=fidget-toy
Terminal=false
Categories=Utility;Game;
EOF

bold "✅ Done!"
info "Launch it from your app menu (search 'Fidget Toy'),"
info "or run:  $BIN_DIR/fidget-toy"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) info "(Tip: add $BIN_DIR to your PATH to run it by name.)" ;;
esac
