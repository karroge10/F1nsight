$ErrorActionPreference = 'Stop'
$root = 'D:\Coding\GitHub Repositories\F1-Stats\v2\ml'
foreach ($idea in @('fastform','similarity')) {
    $taskName = "F1-exp-${idea}-once"
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) { throw "Task already exists: $taskName" }
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$root\scripts\exp_ideas\run.ps1`" -Idea $idea"
    $action = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument $arguments -WorkingDirectory $root
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 5)
    Register-ScheduledTask -TaskName $taskName -Action $action -Settings $settings | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
}
