#!/usr/bin/env bash
# Push the updater signing key + password to GitHub Actions secrets.
#
# The release workflow signs the auto-update bundles with these. They live only
# on the maintainer's machine (gitignored) and in GitHub secrets — never in the
# repo. Run this once after generating the key, or again if you rotate it.
#
# Generate a key (if you don't have one):
#   PW=$(openssl rand -hex 24)
#   echo "$PW" > src-tauri/.updater-key-password
#   pnpm tauri signer generate -w src-tauri/fidget-updater.key -p "$PW"
# then copy the printed public key into tauri.conf.json > plugins.updater.pubkey.
set -euo pipefail

cd "$(dirname "$0")/.."

key="src-tauri/fidget-updater.key"
pw="src-tauri/.updater-key-password"

[ -f "$key" ] || { echo "Missing $key — generate the key first (see header)."; exit 1; }
[ -f "$pw" ]  || { echo "Missing $pw — store the key password there first."; exit 1; }

gh secret set TAURI_SIGNING_PRIVATE_KEY < "$key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < "$pw"

echo "Secrets set:"
gh secret list
