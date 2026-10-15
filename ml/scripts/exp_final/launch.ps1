# Starts both backtests of run.ps1 as one-off scheduled tasks, so they outlive the shell that starts them.
$script = 'D:\Coding\GitHub Repositories\F1nsight\ml\scripts\exp_final\run.ps1'
foreach ($variant in 'base', 'lr2') {
    $name = "F1-exp-final-$variant"
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw "$name already exists" }
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Variant $variant"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(15)
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 6) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings | Out-Null
    "registered $name"
}
