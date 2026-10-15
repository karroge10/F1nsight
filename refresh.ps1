# F1nsight: refresh every data source and the forecast after a session or race.
#
#   .\refresh.ps1                       # skips steps with nothing new
#   .\refresh.ps1 -Force                # run every step
#   .\refresh.ps1 -Only fastf1,predict  # a subset: history, openf1, fantasy, fastf1, penalties, predict, images
#   .\refresh.ps1 -Skip openf1
#
# Logs go to logs\refresh-<time>.log, the step summary to logs\refresh-last.json.
# Exit code: 0 ok, 1 a step failed (others still ran), 3 another refresh is still running.
# The images step (driver headshots and team logos for the site) never fails the refresh: a CDN
# problem logs a warning and the existing images stay. After a successful refresh the static site
# is rebuilt and uploaded to Cloudflare Pages (scripts\publish.ps1); a publish problem logs a
# warning and does not change the exit code.

param(
    [switch]$Force,
    [string[]]$Only,
    [string[]]$Skip
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pipeline = Join-Path $root "pipeline"
$python = Join-Path $pipeline ".venv\Scripts\python.exe"

$site = Join-Path $root "site"
$pipelineOnly = @($Only | Where-Object { $_ -and $_ -ne "images" })
$pipelineSkip = @($Skip | Where-Object { $_ -and $_ -ne "images" })
$runImages = (-not $Only -or $Only -contains "images") -and -not ($Skip -contains "images")
$runPipeline = -not $Only -or $pipelineOnly.Count -gt 0

$arguments = @("-m", "f1p.refresh")
if ($Force) { $arguments += "--force" }
if ($pipelineOnly.Count -gt 0) { $arguments += @("--only", ($pipelineOnly -join ",")) }
if ($pipelineSkip.Count -gt 0) { $arguments += @("--skip", ($pipelineSkip -join ",")) }

$env:PYTHONIOENCODING = "utf-8"
$code = 0
if ($runPipeline) {
    Push-Location $pipeline
    try {
        if (Test-Path $python) {
            & $python @arguments
        } else {
            & uv run python @arguments
        }
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

# Site images: headshots only for new drivers or team changes, logos only for new teams or a
# new season (see site/README.md). Non-fatal by design.
if ($runImages -and $code -ne 3) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Warning "images: node not found, keeping the existing images"
    } else {
        $imageArgs = @()
        if ($Force) { $imageArgs += "--force" }
        Push-Location $site
        try {
            foreach ($script in @("scripts/fetch-images.mjs", "scripts/fetch-current-logos.mjs")) {
                try {
                    & $node.Source --no-warnings $script @imageArgs
                    if ($LASTEXITCODE -ne 0) { Write-Warning "images: $script exited with $LASTEXITCODE, keeping the existing images" }
                } catch {
                    Write-Warning "images: $script failed ($($_.Exception.Message)), keeping the existing images"
                }
            }
        } finally {
            Pop-Location
        }
    }
}

# The site is a static export: rebuild it so the local site and the hosted one show the new data.
if ($code -eq 0) {
    $publish = Join-Path $root "scripts\publish.ps1"
    try {
        & $publish
        if ($LASTEXITCODE -ne 0) { Write-Warning "publish: exited with $LASTEXITCODE, see the output above" }
    } catch {
        Write-Warning "publish: failed ($($_.Exception.Message))"
    }
}
exit $code
