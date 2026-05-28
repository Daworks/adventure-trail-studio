$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ApiAddr = if ($env:TOURMAP_API_ADDR) { $env:TOURMAP_API_ADDR } else { "127.0.0.1:4000" }
$ApiBaseUrl = if ($env:TOURMAP_API_BASE_URL) { $env:TOURMAP_API_BASE_URL } else { "http://$ApiAddr" }
$WebPort = if ($env:PORT) { $env:PORT } else { "3000" }
$WebUrl = "http://localhost:$WebPort"

Set-Location $RootDir

if (-not (Test-Path ".env")) {
  Write-Host ".env 파일이 없습니다."
  Write-Host "카카오맵을 사용하려면 프로젝트 루트에 다음 값을 추가하세요."
  Write-Host ""
  Write-Host "KAKAO_API_KEY=카카오_JavaScript_키"
}

if (-not (Test-Path "node_modules")) {
  Write-Host "node_modules가 없어 npm install을 실행합니다."
  npm install
}

Write-Host "Rust API 서버를 시작합니다: $ApiAddr"
$PreviousTourmapApiAddr = $env:TOURMAP_API_ADDR
$env:TOURMAP_API_ADDR = $ApiAddr
$ApiProcess = Start-Process -FilePath "cargo" -ArgumentList "run" -WorkingDirectory "$RootDir\backend" -NoNewWindow -PassThru
$env:TOURMAP_API_ADDR = $PreviousTourmapApiAddr

Write-Host "Next.js 개발 서버를 시작합니다: $WebUrl"
$PreviousTourmapApiBaseUrl = $env:TOURMAP_API_BASE_URL
$env:TOURMAP_API_BASE_URL = $ApiBaseUrl
$WebProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev", "--", "--port", $WebPort -WorkingDirectory $RootDir -NoNewWindow -PassThru
$env:TOURMAP_API_BASE_URL = $PreviousTourmapApiBaseUrl

Write-Host ""
Write-Host "Adventure Trail Studio 로컬 서버가 시작되었습니다."
Write-Host ""
Write-Host "- 웹 앱: $WebUrl"
Write-Host "- API: $ApiBaseUrl"
Write-Host ""
Write-Host "종료하려면 이 창에서 Ctrl+C를 누르세요."
Write-Host ""

$Opened = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $WebUrl -TimeoutSec 2 | Out-Null
    Start-Process $WebUrl
    $Opened = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $Opened) {
  Write-Host "브라우저 자동 실행을 건너뜁니다. 서버 응답 확인 시간이 초과되었습니다."
}

try {
  Wait-Process -Id $WebProcess.Id
} finally {
  if ($ApiProcess -and -not $ApiProcess.HasExited) {
    Stop-Process -Id $ApiProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if ($WebProcess -and -not $WebProcess.HasExited) {
    Stop-Process -Id $WebProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
