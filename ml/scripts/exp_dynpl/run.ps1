$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'D:\Coding\GitHub Repositories\F1-Stats\v2\ml'
$env:F1ML_DYNPL = '1'
$env:PYTHONUNBUFFERED = '1'
$log = 'reports/exp/dynpl/run.log'
$started = Get-Date
"START $($started.ToString('o'))" | Out-File -FilePath $log -Append
try {
    & 'C:\Users\egots\.local\bin\uv.exe' run python -m f1ml.backtest --label exp_dynpl --features cache/features_dynpl.parquet *>> $log
    if ($LASTEXITCODE -ne 0) { throw "backtest exit $LASTEXITCODE" }
    & 'C:\Users\egots\.local\bin\uv.exe' run python -m f1ml.scorecard exp_dynpl --against exp_bestcar *>> $log
    if ($LASTEXITCODE -ne 0) { throw "scorecard exit $LASTEXITCODE" }
    & 'C:\Users\egots\.local\bin\uv.exe' run python -m scripts.exp_dynpl.report *>> $log
    if ($LASTEXITCODE -ne 0) { throw "report exit $LASTEXITCODE" }
    $finished = Get-Date
    $seconds = ($finished - $started).TotalSeconds
    @{started=$started.ToString('o');finished=$finished.ToString('o');seconds=$seconds;status='completed'} | ConvertTo-Json | Set-Content reports/exp/dynpl/runtime.json
    "COMPLETE seconds=$seconds" | Out-File -FilePath $log -Append
} catch {
    "FAILED $_" | Out-File -FilePath $log -Append
    throw
} finally {
    Unregister-ScheduledTask -TaskName 'F1-exp-dynpl-once' -Confirm:$false
}