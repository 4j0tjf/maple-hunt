param([switch]$RepairDependencies)
# 관리자 PowerShell에서 실행. 완성한 새 빌드 폴더로 서비스 환경만 전환한다.
# Next 빌드의 node_modules에는 junction이 있으므로 빌드 디렉터리를 재귀 이동하지 않는다.
# Windows PowerShell 5.1과 PowerShell 7 모두에서 돈다. 5.1이 한글을 읽도록 이 파일은 UTF-8(BOM)로 저장한다.
$ErrorActionPreference = 'Stop'
# HTTP 상태 코드. 401 같은 오류 응답도 숫자로, 연결 실패는 0으로 돌려준다(-SkipHttpErrorCheck는 PowerShell 7 전용이라 쓰지 않는다).
function Get-HttpStatus([string]$Url) {
    try { return [int](Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 3).StatusCode }
    catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }; return 0 }
}
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$release = ".next-release-$stamp"
$registry = 'HKLM:\SYSTEM\CurrentControlSet\Services\MapleHuntWeb\Parameters'
$config = Get-ItemProperty $registry
if ([IO.Path]::GetFullPath($config.AppDirectory) -ne $project) { throw '서비스 작업 폴더가 이 프로젝트와 다릅니다.' }
$originalEnvironment = @($config.AppEnvironmentExtra | Where-Object { $_ })
$environment = @($originalEnvironment | Where-Object { $_ -notmatch '^HUNT_BUILD_DIR=' }) + @("HUNT_BUILD_DIR=$release")
$logDirectory = Join-Path $project 'logs'
[IO.Directory]::CreateDirectory($logDirectory) | Out-Null
$switched = $false; $stopped = $false
Start-Transcript -Path (Join-Path $logDirectory "deploy-$stamp.log") | Out-Null
Push-Location $project
try {
    if ($RepairDependencies) {
        Stop-Service MapleHuntWeb
        (Get-Service MapleHuntWeb).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        $stopped = $true
        npm ci --ignore-scripts --prefer-offline --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "의존성 복구 실패: $LASTEXITCODE" }
    }
    $env:HUNT_BUILD_DIR = $release
    npm run build
    if ($LASTEXITCODE -ne 0) { npm run build }
    if ($LASTEXITCODE -ne 0) { throw "빌드 실패: $LASTEXITCODE" }
    if (!(Test-Path -LiteralPath (Join-Path $project "$release/BUILD_ID"))) { throw '완성된 빌드가 없습니다.' }
    if (!$stopped) { Stop-Service MapleHuntWeb; (Get-Service MapleHuntWeb).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)); $stopped=$true }
    New-ItemProperty -Path $registry -Name AppEnvironmentExtra -PropertyType MultiString -Value $environment -Force | Out-Null
    $switched = $true
    Start-Service MapleHuntWeb
    $ready = $false
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        # 화면은 200, 로그인이 필요한 API는 401이면 새 빌드가 뜬 것이다.
        if ((Get-HttpStatus 'http://127.0.0.1:3200/hunting') -eq 200 -and (Get-HttpStatus 'http://127.0.0.1:3200/hunting/api/maps') -eq 401) { $ready=$true; break }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw '새 빌드 HTTP 확인 실패' }
    Write-Output "운영 반영 완료: $release (이전 빌드는 보존)"
} catch {
    $deploymentError = $_
    if ($switched) {
        Stop-Service MapleHuntWeb -ErrorAction SilentlyContinue
        if ($originalEnvironment.Count) { New-ItemProperty -Path $registry -Name AppEnvironmentExtra -PropertyType MultiString -Value $originalEnvironment -Force | Out-Null }
        else { Remove-ItemProperty -Path $registry -Name AppEnvironmentExtra -ErrorAction SilentlyContinue }
    }
    if ($stopped) { Start-Service MapleHuntWeb -ErrorAction Continue }
    throw $deploymentError
} finally { Pop-Location; Stop-Transcript | Out-Null }
