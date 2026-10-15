param([Parameter(Mandatory=$true)][ValidateSet('fastform','similarity')][string]$Idea)
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath 'D:\Coding\GitHub Repositories\F1nsight\ml'
$env:F1ML_DYNPL = '0'
$env:F1ML_TEAM_BEST_CAR = '1'
$env:F1ML_FASTFORM = '0'
$env:F1ML_SIMILARITY = '0'
if ($Idea -eq 'fastform') { $env:F1ML_FASTFORM = '1' }
if ($Idea -eq 'similarity') { $env:F1ML_SIMILARITY = '1' }
$env:PYTHONUNBUFFERED = '1'
$log = "reports/exp/ideas/${Idea}_run.log"
$started = Get-Date
"START $($started.ToString('o'))" | Out-File -FilePath $log -Append
try {
    & 'C:\Users\egots\.local\bin\uv.exe' run python -m f1ml.features --out "cache/features_${Idea}.parquet" *>> $log
    if ($LASTEXITCODE -ne 0) { throw "features exit $LASTEXITCODE" }
    & 'C:\Users\egots\.local\bin\uv.exe' run python -m scripts.exp_ideas.check $Idea *>> $log
    if ($LASTEXITCODE -ne 0) { throw "checks exit $LASTEXITCODE" }
    $backtestStarted = Get-Date
    & 'C:\Users\egots\.local\bin\uv.exe' run python -m f1ml.backtest --label "exp_${Idea}" --features "cache/features_${Idea}.parquet" *>> $log
    if ($LASTEXITCODE -ne 0) { throw "backtest exit $LASTEXITCODE" }
    $backtestFinished = Get-Date
    & 'C:\Users\egots\.local\bin\uv.exe' run python -m f1ml.scorecard "exp_${Idea}" --against exp_bestcar *>> $log
    if ($LASTEXITCODE -ne 0) { throw "scorecard exit $LASTEXITCODE" }
    $finished = Get-Date
    $seconds = ($finished - $started).TotalSeconds
    $backtestSeconds = ($backtestFinished - $backtestStarted).TotalSeconds
    @{started=$started.ToString('o');finished=$finished.ToString('o');seconds=$seconds;backtestSeconds=$backtestSeconds;status='completed'} | ConvertTo-Json | Set-Content "reports/exp/ideas/${Idea}_runtime.json" -Encoding UTF8
    "COMPLETE seconds=$seconds backtestSeconds=$backtestSeconds" | Out-File -FilePath $log -Append
} catch {
    "FAILED $_" | Out-File -FilePath $log -Append
    throw
} finally {
    Unregister-ScheduledTask -TaskName "F1-exp-${Idea}-once" -Confirm:$false
}

