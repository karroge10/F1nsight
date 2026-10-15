# F1nsight: retrain gate, run every 6 hours by the task F1nsight-retrain-gate.
#
#   .\scripts\retrain-gate.ps1             # check, and run the gate when there are results the model has not seen
#   .\scripts\retrain-gate.ps1 -Now        # run the gate now, whatever the model's age
#   .\scripts\retrain-gate.ps1 -Register   # create the 6-hourly task
#   .\scripts\retrain-gate.ps1 -Unregister
#   .\scripts\retrain-gate.ps1 -PullState  # first pull the data the cloud refresh collected (also with -Register)
#
# The gate (ml\scripts\retrain_if_better.py) rebuilds features, trains, backtests and promotes
# the new model only if it is not worse. It runs once per new race result, so after every race
# weekend; a rejected candidate is not retried until the next race. After a promotion the
# static site is rebuilt and uploaded (scripts\publish.ps1) and the new model and backtest go
# to the cloud refresh state (cloud\state.py push, needs the gh CLI logged in).
# With -PullState the gate first pulls the cloud refresh's data (every group but the model), so
# a PC that no longer refreshes by itself still retrains on the latest results.
# Every check is appended to logs\retrain-gate-checks.log.

param(
    [switch]$Now,
    [switch]$Register,
    [switch]$Unregister,
    [switch]$PullState
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$ml = Join-Path $root "ml"
$python = Join-Path $ml ".venv\Scripts\python.exe"
$statePython = Join-Path $root "pipeline\.venv\Scripts\python.exe"
$stateScript = Join-Path $root "cloud\state.py"
$dataGroups = "refresh-state,processed,serve,predictions,backtest,raw-openf1,raw-livetiming,raw-fastf1,raw-other"
$logs = Join-Path $root "logs"
$taskName = "F1nsight-retrain-gate"

function Main {
    if ($Register) { Register-GateTask; return }
    if ($Unregister) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "Removed $taskName"
        return
    }
    New-Item -ItemType Directory -Force $logs | Out-Null
    $checkLog = Join-Path $logs "retrain-gate-checks.log"
    $arguments = @("scripts\retrain_if_better.py")
    if (-not $Now) { $arguments += "--when-due" }
    $env:PYTHONIOENCODING = "utf-8"
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $checkLog -Value "$stamp check" -Encoding utf8
    if ($PullState) { Invoke-State $checkLog @("pull", "--groups", $dataGroups) }
    Push-Location $ml
    try {
        $output = & $python @arguments 2>&1
        $code = $LASTEXITCODE
        $text = $output | Out-String
        Write-Host $text
        Add-Content -Path $checkLog -Value $text -Encoding utf8
    } finally {
        Pop-Location
    }
    if ($text -match "retrain gate: promoted") {
        Publish-Site $checkLog
        Invoke-State $checkLog @("push", "--groups", "model,backtest")
    }
    exit $code
}

# A promoted model writes a new forecast; the site is static, so rebuild and upload it.
function Publish-Site($checkLog) {
    $publish = Join-Path $root "scripts\publish.ps1"
    $ErrorActionPreference = "Continue"
    $output = & $publish 2>&1
    $text = $output | Out-String
    Write-Host $text
    Add-Content -Path $checkLog -Value $text -Encoding utf8
}

# cloud\state.py pull or push. Never fails the gate: a problem is logged and the gate goes on.
function Invoke-State($checkLog, [string[]]$StateArgs) {
    $ErrorActionPreference = "Continue"
    $output = & $statePython $stateScript @StateArgs 2>&1
    $exitCode = $LASTEXITCODE
    $text = $output | Out-String
    if ($exitCode -ne 0) { $text += "state: cloud\state.py $($StateArgs[0]) exited with $exitCode`n" }
    Write-Host $text
    Add-Content -Path $checkLog -Value $text -Encoding utf8
}

function Register-GateTask {
    $arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($PullState) { $arguments += " -PullState" }
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $root
    $start = (Get-Date).AddMinutes(5)
    $every = New-TimeSpan -Hours 6
    $trigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval $every
    $limit = New-TimeSpan -Hours 5
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit $limit -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
        -Description "F1nsight: after new race results, retrain and promote the model only if its backtest is not worse" -Force | Out-Null
    $first = $start.ToString("yyyy-MM-dd HH:mm")
    Write-Host "Registered ${taskName}: every 6 hours from $first"
}

Main
