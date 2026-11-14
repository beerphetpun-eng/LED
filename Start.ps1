param([switch]$NoBrowser, [switch]$Build)
$ErrorActionPreference = 'Stop'
$nodePath = 'C:\Program Files\nodejs'
if (Test-Path -LiteralPath $nodePath) { $env:PATH = "$nodePath;$env:PATH" }
$launchArgs = @()
if ($NoBrowser) { $launchArgs += '--no-browser' }
if ($Build) { $launchArgs += '--build' }
& node.exe (Join-Path $PSScriptRoot 'launch.mjs') @launchArgs
exit $LASTEXITCODE
