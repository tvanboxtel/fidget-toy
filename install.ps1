# Fidget Toy installer for Windows.
#
#   irm https://raw.githubusercontent.com/tvanboxtel/fidget-toy/main/install.ps1 | iex
#
# Downloads the latest .msi release and runs the installer.
$ErrorActionPreference = "Stop"

$repo = "tvanboxtel/fidget-toy"

Write-Host "🔴 Installing Fidget Toy..." -ForegroundColor Cyan

try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "fidget-toy-installer" }
} catch {
    Write-Host "✘ Couldn't reach GitHub. Are you online?" -ForegroundColor Red
    exit 1
}

# Prefer the .msi installer; fall back to a setup .exe if that's what was built.
$asset = $release.assets | Where-Object { $_.name -like "*.msi" } | Select-Object -First 1
if (-not $asset) {
    $asset = $release.assets | Where-Object { $_.name -like "*setup*.exe" } | Select-Object -First 1
}
if (-not $asset) {
    Write-Host "✘ No Windows installer found in the latest release." -ForegroundColor Red
    exit 1
}

$dest = Join-Path $env:TEMP $asset.name
Write-Host "  Downloading $($asset.name)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -UseBasicParsing

Write-Host "  Launching the installer (click through the prompts)..."
if ($asset.name -like "*.msi") {
    Start-Process msiexec.exe -ArgumentList "/i `"$dest`"" -Wait
} else {
    Start-Process $dest -Wait
}

Write-Host "✅ Done! Open 'Fidget Toy' from your Start menu." -ForegroundColor Green
