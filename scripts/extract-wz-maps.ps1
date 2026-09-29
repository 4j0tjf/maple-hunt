param(
    [Parameter(Mandatory=$true)][string]$WcrDirectory,
    [Parameter(Mandatory=$true)][string]$GameDirectory,
    [string]$Output = (Join-Path $PSScriptRoot '..\data\extracted-hunting-maps.json')
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 이상으로 실행하세요.' }
$library = Join-Path $WcrDirectory 'Lib\WzComparerR2.WzLib.dll'
if (!(Test-Path -LiteralPath $library)) { throw "위컴알 라이브러리 없음: $library" }
[System.Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $library).Path) | Out-Null
$references = @((Get-ChildItem (Join-Path $PSHOME 'ref') -Filter '*.dll').FullName) + @($library)
Add-Type -Path (Join-Path $PSScriptRoot 'WzHuntingExtractor.cs') -ReferencedAssemblies $references -CompilerOptions '/nowarn:1701,1702'
$result = [WzHuntingExtractor]::Run((Resolve-Path -LiteralPath $GameDirectory).Path)
if ($result.catalog.maps.Count -eq 0) { throw '추출된 사냥터가 없습니다. 원본 형식을 확인하세요.' }
$destination = [IO.Path]::GetFullPath($Output)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
$result.catalog | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $destination -Encoding utf8
$report = $destination + '.report.json'
[pscustomobject]@{ version=$result.catalog.version; maps=$result.catalog.maps.Count; mapImages=$result.mapImages; mobImages=$result.mobImages; skipped=$result.skipped; errors=$result.errors } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $report -Encoding utf8
Write-Output "추출 완료: $($result.catalog.maps.Count)개 / 맵 이미지 $($result.mapImages)개 / 오류 $($result.errors.Count)개"
Write-Output "데이터: $destination"
Write-Output "검토 보고서: $report"
if ($result.errors.Count -gt 0) { Write-Warning '누락/해석 오류는 보고서를 확인하세요. 현재 명령은 운영 목록을 교체하지 않습니다.' }
