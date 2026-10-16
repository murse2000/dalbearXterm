$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$analysisRoot = Join-Path $PSScriptRoot '..\.tools'
New-Item -ItemType Directory -Path $analysisRoot -Force | Out-Null
# REA가 지원하는 고정 Ghidra 버전과 JDK 21을 프로젝트 안에 설치한다.
$ghidraRelease = Invoke-RestMethod 'https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/tags/Ghidra_12.1.4_build'
$ghidraAsset = $ghidraRelease.assets | Where-Object name -eq 'ghidra_12.1.4_PUBLIC_20260921.zip'
if (-not $ghidraAsset) { throw 'Ghidra 배포 파일을 찾지 못했습니다.' }
$jdkAssets = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
$jdkAsset = $jdkAssets[0].binary.package
$downloads = @(
    @{ Name='ghidra'; Url=$ghidraAsset.browser_download_url; Hash=($ghidraAsset.digest -replace '^sha256:', ''); File=(Join-Path $analysisRoot 'ghidra.zip') },
    @{ Name='jdk'; Url=$jdkAsset.link; Hash=$jdkAsset.checksum; File=(Join-Path $analysisRoot 'jdk.zip') }
)
foreach ($download in $downloads) {
    if (-not $download.Hash) { throw "$($download.Name) 체크섬이 없습니다." }
    if (-not (Test-Path -LiteralPath $download.File)) {
        Invoke-WebRequest -Uri $download.Url -OutFile $download.File
    }
    if ((Get-FileHash -LiteralPath $download.File -Algorithm SHA256).Hash -ne $download.Hash) { throw "$($download.Name) 체크섬 불일치" }
    Expand-Archive -LiteralPath $download.File -DestinationPath $analysisRoot -Force
    Write-Output "$($download.Name): 다운로드·체크섬·압축 해제 완료"
}
