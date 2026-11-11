param([switch]$NoBrowser, [switch]$Build)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodePath = 'C:\Program Files\nodejs'
if (Test-Path -LiteralPath $nodePath) { $env:PATH = "$nodePath;$env:PATH" }
$serverPath = Join-Path $projectRoot 'server'
if (-not (Test-Path (Join-Path $serverPath 'appsettings.Local.json'))) {
    throw 'Create server/appsettings.Local.json with ConnectionStrings:Postgres first. See README.md.'
}
if ($Build -or -not (Test-Path (Join-Path $serverPath 'wwwroot\index.html'))) {
    Push-Location (Join-Path $projectRoot 'client')
    try {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Client build failed' }
    } finally { Pop-Location }
}
Push-Location $serverPath
try {
    if (-not (Test-Path '.\node_modules\playwright')) {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Server dependency installation failed' }
    }
    & node.exe '.\node_modules\playwright\cli.js' install chromium
    if ($LASTEXITCODE -ne 0) { throw 'Browser install failed' }
    if ($NoBrowser) { & node.exe app.mjs } else { & node.exe app.mjs --open }
} finally { Pop-Location }
