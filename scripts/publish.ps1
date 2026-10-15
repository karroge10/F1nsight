# F1nsight: build the static site and upload it to Cloudflare Pages.
#
#   .\scripts\publish.ps1               # build site\out, check the Pages limits, deploy
#   .\scripts\publish.ps1 -SkipBuild    # deploy the existing site\out as it is
#   .\scripts\publish.ps1 -NoDeploy     # build and check only (the local site serves site\out too)
#
# refresh.ps1 runs this after every successful refresh, so the local site and the hosted one both
# show the new data. Wrangler must be logged in once (npx wrangler login); without a login the
# build still runs, the upload is skipped with a hint and the script exits 0.
# Exit code: 0 ok or not logged in, 1 the build, the limits check or the upload failed.

param(
    [switch]$SkipBuild,
    [switch]$NoDeploy
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$site = Join-Path $root "site"
$wrangler = Join-Path $site "node_modules\.bin\wrangler.cmd"
$projectName = "f1nsight"
$branch = "main"

function Main {
    Push-Location $site
    try {
        if (-not $SkipBuild) {
            Write-Host "publish: building the static site..."
            if (-not (Invoke-Native "npm" @("run", "build"))) { return 1 }
        }
        if (-not (Invoke-Native "node" @("scripts/check-export.mjs"))) { return 1 }
        if ($NoDeploy) { return 0 }
        if (-not (Test-WranglerLogin)) {
            Write-Host "publish: wrangler is not logged in, skipping the upload. Run 'npx wrangler login' in site once to enable it."
            return 0
        }
        Write-Host "publish: uploading site\out to Cloudflare Pages ($projectName, $branch)..."
        # Run wrangler outside site\: there it detects Next.js and rewrites the project for an
        # OpenNext Worker (wrangler.jsonc, package.json, next.config.ts) instead of uploading out.
        $out = Join-Path $site "out"
        $deployArgs = @("pages", "deploy", $out, "--project-name", $projectName, "--branch", $branch, "--commit-dirty=true")
        Push-Location $root
        try {
            $deployed = Invoke-Native $wrangler $deployArgs
        } finally {
            Pop-Location
        }
        if (-not $deployed) { return 1 }
        Write-Host "publish: done"
        return 0
    } finally {
        Pop-Location
    }
}

# Runs a native command with stderr allowed (node prints ExperimentalWarning there) and reports
# success by its exit code only.
function Invoke-Native([string]$Command, [string[]]$Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Command @Arguments | Out-Host
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($exitCode -ne 0) {
        Write-Warning "publish: $Command $($Arguments -join ' ') exited with $exitCode"
        return $false
    }
    return $true
}

function Test-WranglerLogin {
    # An API token scoped to Pages can deploy but cannot run whoami, so trust it as it is.
    if ($env:CLOUDFLARE_API_TOKEN) { return $true }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $wrangler whoami 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($exitCode -ne 0) { return $false }
    return $output -notmatch "not authenticated"
}

$code = Main
exit $code
