# One walk-forward backtest for the 2026-10-13 model update, run as a scheduled task (see launch.ps1).
#   base: rating features on, circuit speed from earlier visits only
#   lr2:  base plus the corrected long run pace (F1ML_LONGRUN2)
param([Parameter(Mandatory=$true)][ValidateSet('base','lr2')][string]$Variant)
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath 'D:\Coding\GitHub Repositories\F1nsight\ml'
$env:F1ML_DYNPL = '1'
$env:F1ML_TEAM_BEST_CAR = '1'
$env:F1ML_LONGRUN2 = if ($Variant -eq 'lr2') { '1' } else { '0' }
$env:PYTHONUNBUFFERED = '1'
$uv = 'C:\Users\egots\.local\bin\uv.exe'
$label = "exp_final_$Variant"
$log = "reports/exp/final/$Variant.log"
New-Item -ItemType Directory -Force 'reports/exp/final' | Out-Null
"START $((Get-Date).ToString('o'))" | Out-File -FilePath $log -Append -Encoding utf8
try {
    & $uv run python -m f1ml.features --out "cache/features_$label.parquet" *>> $log
    if ($LASTEXITCODE -ne 0) { throw "features exit $LASTEXITCODE" }
    & $uv run python -m f1ml.backtest --label $label --features "cache/features_$label.parquet" *>> $log
    if ($LASTEXITCODE -ne 0) { throw "backtest exit $LASTEXITCODE" }
    & $uv run python -m f1ml.scorecard $label --against exp_dynpl *>> $log
    if ($LASTEXITCODE -ne 0) { throw "scorecard exit $LASTEXITCODE" }
    "COMPLETE $((Get-Date).ToString('o'))" | Out-File -FilePath $log -Append -Encoding utf8
} catch {
    "FAILED $_" | Out-File -FilePath $log -Append -Encoding utf8
} finally {
    Unregister-ScheduledTask -TaskName "F1-exp-final-$Variant" -Confirm:$false
}
