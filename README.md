<h1 align="center">🔴 Fidget Toy</h1>

<p align="center">
  A little red ball on a string that hangs out on your desktop.<br>
  Drag it, fling it, bat it around, or yank the string until it snaps.
</p>

---

## ⬇️ Install (just want to use it)

### ⚡ The one-command way (easiest)

Open your terminal and paste **one** of these:

**🍎 Mac / 🐧 Linux** — Terminal:
```sh
curl -fsSL https://raw.githubusercontent.com/tvanboxtel/fidget-toy/main/install.sh | bash
```

**🪟 Windows** — PowerShell:
```powershell
irm https://raw.githubusercontent.com/tvanboxtel/fidget-toy/main/install.ps1 | iex
```

That downloads the right version for your computer and installs it. On Mac it even skips the "unidentified developer" warning for you.

> To open a terminal: **Mac** → Spotlight (⌘+Space), type "Terminal". **Windows** → Start menu, type "PowerShell". **Linux** → you know how.

---

### 🖱️ The click-around way

**[👉 Click here to download the latest version.](https://github.com/tvanboxtel/fidget-toy/releases/latest)**

On that page, scroll down to **Assets** and grab the file for your computer:

### 🪟 Windows
1. Download the file ending in **`.msi`**.
2. Double-click it and click **Next → Next → Finish**.
3. If Windows shows a blue "Windows protected your PC" box: click **More info → Run anyway**. (It's safe — it's just not signed.)
4. Open **Fidget Toy** from your Start menu.

### 🍎 Mac
1. Download the file ending in **`.dmg`**.
   - New Mac (M1/M2/M3/etc.)? Get the one that says **`aarch64`**.
   - Older Intel Mac? Get the one that says **`x64`**.
   - Not sure? Grab **`aarch64`** first; if it won't open, try the other.
2. Double-click the `.dmg`, then drag **Fidget Toy** into your **Applications** folder.
3. The first time, **right-click the app → Open → Open**. (Just double-clicking will say it's from an "unidentified developer" — right-clicking gets past it. It's safe, just not signed.)

### 🐧 Linux
- Easiest: download the **`.AppImage`**, right-click it → Properties → check **"Allow executing as program"**, then double-click it.
- Or use the **`.deb`** (Ubuntu/Debian) / **`.rpm`** (Fedora) with your package manager.

---

## 🎮 How to play

- **Drag** the ball around with your mouse.
- **Fling** it — drag fast and let go; it swings on the string.
- **Bat** it — swipe your cursor through it to knock it.
- **Snap the string** — yank the ball far enough and the rope breaks; the ball drops and bounces around your screen.
- **Re-tie it** — drag the loose ball back up to the top-center and let go.
- **Quit** — click the Fidget Toy icon in your **system tray / menu bar** → **Quit**.

The ball floats on top of everything, and clicks anywhere *except* the ball pass straight through to whatever's behind it.

---

## 🛠️ Run from source (for developers)

Requires [Node.js](https://nodejs.org), [pnpm](https://pnpm.io), and the [Rust toolchain](https://rustup.rs) plus [Tauri's system dependencies](https://tauri.app/start/prerequisites/).

```sh
pnpm install      # install frontend dependencies
pnpm tauri dev    # run the app with hot-reload
pnpm tauri build  # build installers for your current OS
```

Built installers land in `src-tauri/target/release/bundle/`.

### Releasing

Pushing a version tag triggers a GitHub Actions build that produces installers for Windows, macOS, and Linux and attaches them to a draft GitHub Release:

```sh
git tag v0.1.0
git push origin v0.1.0
```

### Tuning the feel

All the physics knobs (gravity, string stiffness, bounciness, batting force, etc.) live as named constants at the top of [`src/main.ts`](src/main.ts).
