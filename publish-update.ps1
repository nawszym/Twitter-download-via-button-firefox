<#
.SYNOPSIS
Reads AMO credentials from amo-credentials.txt, signs v1.1.6 as a LISTED
update to the existing add-on. The credentials file is kept on disk.

Credentials file format - either two unlabeled lines:
user:12345:678
0123456789abcdef...
or labeled:
KEY=user:12345:678
SECRET=0123456789abcdef...
#>
$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $project

$credFile = Join-Path $project 'amo-credentials.txt'
if (-not (Test-Path $credFile)) { throw "Missing $credFile" }

$lines = @(Get-Content $credFile | Where-Object { $_.Trim() -ne '' })
$key = ($lines | Where-Object { $_ -match '^KEY=' } | Select-Object -First 1) -replace '^KEY=',''
$secret = ($lines | Where-Object { $_ -match '^SECRET=' } | Select-Object -First 1) -replace '^SECRET=',''
if (-not $key -and $lines.Count -ge 1) { $key = $lines[0].Trim() }
if (-not $secret -and $lines.Count -ge 2) { $secret = $lines[1].Trim() }
if (-not $key -or -not $secret) { throw 'amo-credentials.txt needs a key (user:...) and a secret.' }

$npx = 'C:\Program Files\nodejs\npx.cmd'
if (-not (Test-Path $npx)) { $npx = (Get-Command npx.cmd -ErrorAction Stop).Source }
$artifacts = Join-Path $project 'signed'
if (-not (Test-Path $artifacts)) { New-Item -ItemType Directory -Path $artifacts | Out-Null }
$source = Join-Path $project 'sign-source'

# Rebuild the clean signing source from the tracked source files. The
# sign-source/ folder is gitignored, so this makes a fresh clone work.
if (-not (Test-Path $source)) { New-Item -ItemType Directory -Path $source | Out-Null }
Copy-Item (Join-Path $project 'manifest.json'),
          (Join-Path $project 'content.js'),
          (Join-Path $project 'content.css'),
          (Join-Path $project 'background.js'),
          (Join-Path $project 'icon-48.png'),
          (Join-Path $project 'icon-96.png'),
          (Join-Path $project 'LICENSE') -Destination $source -Force

Write-Host 'Submitting listed update 1.1.6 to AMO...' -ForegroundColor Cyan
& $npx --yes web-ext@latest sign --channel=listed --source-dir $source --artifacts-dir $artifacts --api-key $key --api-secret $secret
$code = $LASTEXITCODE

# The credentials file is intentionally kept on disk.
Write-Host 'Credentials file kept on disk.' -ForegroundColor Green

if ($code -ne 0) { throw "web-ext sign failed (exit $code). AMO may need a higher version number." }

Get-ChildItem $artifacts -Filter '*.xpi' | Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 Name, Length, LastWriteTime






