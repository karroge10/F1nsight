# F1nsight: start the live service and the site, then open the browser.
#
#   .\start.ps1              # live service on 8765, site on 3000, open http://localhost:3000
#   .\start.ps1 -Rebuild     # force a fresh static build first
#   .\start.ps1 -NoBrowser
#
# Anything already listening (a dev server on 3000, the live service on 8765) is left alone and
# reused. Otherwise the site is the static export in site\out (the same files Cloudflare Pages
# serves), served by site\scripts\serve-static.mjs and rebuilt first when the code or the data is
# newer than the last build. refresh.ps1 rebuilds after every refresh; the server picks the new
# files up without a restart. Output: v2\logs\live.log, v2\logs\site.log.

param(
    [switch]$Rebuild,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$site = Join-Path $root "site"
$live = Join-Path $root "live"
$logs = Join-Path $root "logs"
$sitePort = 3000
$livePort = 8765

function Main {
    New-Item -ItemType Directory -Force $logs | Out-Null
    Start-LiveService
    Start-Site
    Wait-ForUrl "http://localhost:$sitePort/icon.svg" 180
    if (-not $NoBrowser) { Start-Process "http://localhost:$sitePort/" }
    Write-Host "F1nsight is up: site http://localhost:$sitePort/  live service http://localhost:$livePort/status"
}

function Start-LiveService {
    if (Test-Port $livePort) {
        Write-Host "Live service already running on $livePort"
        return
    }
    $python = Join-Path $live ".venv\Scripts\python.exe"
    $logFile = Join-Path $logs "live.log"
    $errorFile = Join-Path $logs "live.err.log"
    Write-Host "Starting the live service on $livePort (log $logFile)"
    Start-Process -FilePath $python -ArgumentList @("-m", "f1live") -WorkingDirectory $live -WindowStyle Hidden `
        -RedirectStandardOutput $logFile -RedirectStandardError $errorFile | Out-Null
    Wait-ForUrl "http://localhost:$livePort/status" 60
}

function Start-Site {
    if (Test-Port $sitePort) {
        Write-Host "Site already running on $sitePort (dev or production), reusing it"
        return
    }
    if ($Rebuild -or (Test-BuildStale)) {
        Write-Host "Building the static site..."
        Push-Location $site
        $ErrorActionPreference = "Continue"
        try {
            & npm run build | Out-Host
            $buildCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = "Stop"
            Pop-Location
        }
        if ($buildCode -ne 0) { throw "npm run build failed" }
    }
    $logFile = Join-Path $logs "site.log"
    $errorFile = Join-Path $logs "site.err.log"
    Write-Host "Serving the static site on $sitePort (log $logFile)"
    Start-Process -FilePath "node" -ArgumentList @("scripts/serve-static.mjs", "--port", "$sitePort") -WorkingDirectory $site -WindowStyle Hidden `
        -RedirectStandardOutput $logFile -RedirectStandardError $errorFile | Out-Null
}

function Test-BuildStale {
    $builtPage = Join-Path $site "out\index.html"
    if (-not (Test-Path $builtPage)) { return $true }
    $builtAt = (Get-Item $builtPage).LastWriteTime
    $data = Join-Path $root "data"
    $sources = @(
        (Join-Path $site "src"),
        (Join-Path $site "public"),
        (Join-Path $site "package.json"),
        (Join-Path $site "next.config.ts"),
        (Join-Path $data "serve"),
        (Join-Path $data "predictions")
    )
    $newest = Get-ChildItem -Path $sources -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    return ($null -ne $newest) -and ($newest.LastWriteTime -gt $builtAt)
}

function Test-Port([int]$Port) {
    $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $listening
}

function Wait-ForUrl([string]$Url, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 | Out-Null
            return
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    Write-Warning "$Url did not answer within $TimeoutSeconds s (see $logs)"
}

Main
