# Asks for the GitHub token once (hidden), checks it can see the repo's Actions, then stores it
# as the GitHub secret F1_DISPATCH_TOKEN and as the f1nsight-cron Worker secret GITHUB_TOKEN.
$ErrorActionPreference = 'Stop'
$repo = 'karroge10/F1nsight'
$workerDir = 'D:\Coding\GitHub Repositories\F1-Stats\v2\cloud\cron-worker'

$secure = Read-Host 'Paste the GitHub token and press Enter (input is hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
$token = $token.Trim()

$headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'f1nsight-setup' }
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/actions/workflows" -Headers $headers | Out-Null
    Write-Host 'Token works for the repo.' -ForegroundColor Green
} catch {
    Write-Host "This token cannot read $repo Actions: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

gh secret set F1_DISPATCH_TOKEN --repo $repo --body $token
Write-Host 'Saved as GitHub secret F1_DISPATCH_TOKEN.' -ForegroundColor Green

$tmp = Join-Path $env:TEMP ("f1t-" + [guid]::NewGuid().ToString('N'))
try {
    [IO.File]::WriteAllText($tmp, $token)
    Push-Location $workerDir
    cmd /c "npx --yes wrangler@4 secret put GITHUB_TOKEN < `"$tmp`""
    Pop-Location
} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
Write-Host 'Saved in the Cloudflare Worker. All done, you can close this window.' -ForegroundColor Green
Read-Host 'Press Enter to close'
