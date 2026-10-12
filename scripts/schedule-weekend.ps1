# F1nsight: Windows Task Scheduler tasks that run refresh.ps1 after every session.
#
#   .\scripts\schedule-weekend.ps1                        # next race weekend + the weekly fallback
#   .\scripts\schedule-weekend.ps1 -Season 2026 -Round 18 # a specific weekend
#   .\scripts\schedule-weekend.ps1 -List                  # show every F1nsight task and its next run
#   .\scripts\schedule-weekend.ps1 -Remove                # remove the per-session tasks (keeps weekly)
#   .\scripts\schedule-weekend.ps1 -RemoveAll             # remove every F1nsight task
#
# Per session: F1nsight-refresh-<FP1|FP2|FP3|SQ|Sprint|Quali|Race> about 60 to 75 minutes after the
# session ends, and F1nsight-refresh-<session>-retry 3 hours later (times from `python -m
# f1p.weekend`), plus F1nsight-refresh-RaceMorning 3 hours before the race start so grid penalties
# announced overnight reach the forecast. Registering again overwrites tasks with the same name, so the weekly task
# (Mondays 10:00 local, refresh -Force) also schedules the following weekend by itself.
# Tasks run as the current user while logged on (no password stored) and start as soon as
# possible if the PC was off or asleep at the planned time.

param(
    [int]$Season,
    [int]$Round,
    [switch]$List,
    [switch]$Remove,
    [switch]$RemoveAll
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$pipeline = Join-Path $root "pipeline"
$python = Join-Path $pipeline ".venv\Scripts\python.exe"
$refresh = Join-Path $root "refresh.ps1"
$self = $PSCommandPath
$weeklyName = "F1nsight-refresh-weekly"

function Main {
    if ($List) { Show-Tasks; return }
    if ($RemoveAll) { Remove-Tasks "F1nsight-*"; return }
    if ($Remove) { Remove-SessionTasks; return }
    $plan = Get-Plan
    Write-Host ("{0} R{1} {2}" -f $plan.season, $plan.round, $plan.raceName)
    foreach ($task in $plan.tasks) {
        $runAt = ([DateTimeOffset]::Parse($task.runAtIso)).LocalDateTime
        $description = "{0} {1}: {2}" -f $plan.raceName, $plan.season, $task.note
        Register-RefreshTask -Name $task.name -RunAt $runAt -Description $description
        Write-Host ("  {0,-32} {1} local  {2} UTC" -f $task.name, $task.runAtLocal, $task.runAtUtc)
    }
    Register-WeeklyTask
    Write-Host "  $weeklyName              Mondays 10:00 local (refresh -Force, then schedules the next weekend)"
}

function Get-Plan {
    $arguments = @("-m", "f1p.weekend", "--json")
    if ($Season -and $Round) { $arguments += @("--season", $Season, "--round", $Round) }
    $env:PYTHONIOENCODING = "utf-8"
    Push-Location $pipeline
    try {
        $json = & $python @arguments
        if ($LASTEXITCODE -ne 0) { throw "f1p.weekend failed" }
    } finally {
        Pop-Location
    }
    return ($json -join "`n") | ConvertFrom-Json
}

function Register-RefreshTask([string]$Name, [datetime]$RunAt, [string]$Description) {
    $action = New-RefreshAction ""
    $trigger = New-ScheduledTaskTrigger -Once -At $RunAt
    $settings = New-TaskSettings
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings `
        -Description $Description -Force | Out-Null
}

function Register-WeeklyTask {
    $refreshAction = New-RefreshAction "-Force"
    $scheduleArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$self`""
    $scheduleAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $scheduleArguments -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "10:00"
    $settings = New-TaskSettings
    Register-ScheduledTask -TaskName $weeklyName -Action @($refreshAction, $scheduleAction) -Trigger $trigger `
        -Settings $settings -Description "F1nsight weekly fallback refresh, then tasks for the next race weekend" -Force | Out-Null
}

function New-RefreshAction([string]$Extra) {
    $arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$refresh`" $Extra"
    $trimmed = $arguments.Trim()
    return New-ScheduledTaskAction -Execute "powershell.exe" -Argument $trimmed -WorkingDirectory $root
}

function New-TaskSettings {
    $limit = New-TimeSpan -Hours 3
    return New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit $limit -MultipleInstances IgnoreNew
}

function Show-Tasks {
    Get-ScheduledTask -TaskName "F1nsight-*" -ErrorAction SilentlyContinue | ForEach-Object {
        $info = $_ | Get-ScheduledTaskInfo
        [pscustomobject]@{
            Task       = $_.TaskName
            State      = $_.State
            NextRun    = $info.NextRunTime
            LastRun    = $info.LastRunTime
            LastResult = $info.LastTaskResult
        }
    } | Sort-Object NextRun | Format-Table -AutoSize
}

function Remove-SessionTasks {
    Get-ScheduledTask -TaskName "F1nsight-refresh-*" -ErrorAction SilentlyContinue |
        Where-Object { $_.TaskName -ne $weeklyName } |
        Unregister-ScheduledTask -Confirm:$false
    Write-Host "Removed the per-session F1nsight refresh tasks (weekly and retrain tasks kept)."
}

function Remove-Tasks([string]$Pattern) {
    Get-ScheduledTask -TaskName $Pattern -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
    Write-Host "Removed every task matching $Pattern."
}

Main
