<#
.SYNOPSIS
Signs (unlisted) and permanently installs Twitter Media via Button into the
active desktop Firefox profile.

.EXAMPLE
# Step 1 - get API key + secret from https://addons.mozilla.org/en-US/developers/addon/api/key/
.\install-permanent.ps1 -ApiKey 'jwt:...' -ApiSecret '...'

# Step 2 - or, if you already downloaded a signed XPI from AMO:
.\install-permanent.ps1 -SignedXpi '.\signed\twitter_media_via_button-1.0-an+fx.xpi'
#>
param(
  [string]$ApiKey,
  [string]$ApiSecret,
  [string]$SignedXpi
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $project

function Get-ActiveFirefoxProfile {
  $ini = Join-Path $env:APPDATA 'Mozilla\Firefox\profiles.ini'
  if (-not (Test-Path $ini)) { throw "profiles.ini not found: $ini" }
  $lines = Get-Content $ini
  $default = ($lines | Where-Object { $_ -match '^Default=Profiles[\\/]' } | Select-Object -First 1) -replace '^Default=Profiles[\\/]',''
  if (-not $default) { throw 'Could not determine the default Firefox profile.' }
  return (Join-Path (Join-Path $env:APPDATA 'Mozilla\Firefox\Profiles') $default)
}

# Allow credentials to come from environment variables so the secret never
# has to be typed into a command line or pasted into a chat.
if (-not $ApiKey)    { $ApiKey    = $env:WEB_EXT_API_KEY }
if (-not $ApiSecret) { $ApiSecret = $env:WEB_EXT_API_SECRET }

if (-not $SignedXpi -and (-not $ApiKey -or -not $ApiSecret)) {
  throw "Provide -ApiKey/-ApiSecret or set WEB_EXT_API_KEY and WEB_EXT_API_SECRET, or pass -SignedXpi."
}

# 1) Sign via AMO (unlisted) if credentials were provided
if ($ApiKey -and $ApiSecret) {
  $npx = 'C:\Program Files\nodejs\npx.cmd'
  if (-not (Test-Path $npx)) { $npx = (Get-Command npx.cmd -ErrorAction Stop).Source }
  $artifacts = Join-Path $project 'signed'
  if (-not (Test-Path $artifacts)) { New-Item -ItemType Directory -Path $artifacts | Out-Null }
  $sourceDir = Join-Path $project 'sign-source'
  if (-not (Test-Path $sourceDir)) { New-Item -ItemType Directory -Path $sourceDir | Out-Null }
  Copy-Item (Join-Path $project 'manifest.json'),
            (Join-Path $project 'content.js'),
            (Join-Path $project 'content.css'),
            (Join-Path $project 'background.js'),
            (Join-Path $project 'icon-48.png'),
            (Join-Path $project 'icon-96.png'),
            (Join-Path $project 'LICENSE') -Destination $sourceDir -Force

  Write-Host 'Signing with AMO (unlisted channel)...' -ForegroundColor Cyan
  & $npx --yes web-ext@latest sign --channel=unlisted --source-dir $sourceDir --artifacts-dir $artifacts --api-key $ApiKey --api-secret $ApiSecret
  if ($LASTEXITCODE -ne 0) { throw "web-ext sign failed (exit $LASTEXITCODE)." }

  $SignedXpi = (Get-ChildItem $artifacts -Filter '*.xpi' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
  if (-not $SignedXpi) { throw 'Signing produced no XPI.' }
}

if (-not (Test-Path $SignedXpi)) { throw "Signed XPI not found: $SignedXpi" }

# 2) Verify it really is signed (contains META-INF/manifest.mf)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $SignedXpi))
$signed = ($zip.Entries | Where-Object { $_.FullName -eq 'META-INF/manifest.mf' }).Count -gt 0
$zip.Dispose()
if (-not $signed) {
  throw "The XPI is not signed by Mozilla (no META-INF/manifest.mf). Cannot install permanently."
}

# 3) Install into the active profile
$profile = Get-ActiveFirefoxProfile
$extDir = Join-Path $profile 'extensions'
if (-not (Test-Path $extDir)) { New-Item -ItemType Directory -Path $extDir | Out-Null }

$id = 'twitter-media-via-button@local.addon'
$target = Join-Path $extDir ($id + '.xpi')

# Move aside old disabled/unknown copies of this add-on
$backup = Join-Path $extDir 'disabled-twitter-media-backup'
Get-ChildItem $extDir -Filter '*.xpi' | Where-Object {
  $_.Name -ne (Split-Path $SignedXpi -Leaf) -and
  ($_.Length -lt 20000) -and
  ($_.Name -like '*twitter*' -or $_.Name -like '*local.addon*')
} | ForEach-Object {
  if (-not (Test-Path $backup)) { New-Item -ItemType Directory -Path $backup | Out-Null }
  Move-Item $_.FullName (Join-Path $backup $_.Name) -Force
  Write-Host "Moved aside old copy: $($_.Name)"
}

Copy-Item (Resolve-Path $SignedXpi) $target -Force
Write-Host "Installed signed add-on to: $target" -ForegroundColor Green
Write-Host 'Restart Firefox completely (close all windows, then reopen) to activate it.' -ForegroundColor Yellow
