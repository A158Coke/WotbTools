<#
.SYNOPSIS
  Build WoT Blitz Replay Extractor offline EXE (portable mode).
.DESCRIPTION
  1. Uses portable tools from tools/ subdirectory if present.
  2. Falls back to system PATH (JAVA_HOME, mvn, node).
  3. Auto-downloads missing tools to tools/ (cached for reuse).
  4. Builds Vue frontend, Maven jar, then jpackage app-image.
.PARAMETER NoDownload
  Skip auto-download of missing tools (fail instead).
.PARAMETER SkipFrontend
  Skip Vue frontend build (use existing dist/).
.PARAMETER SkipMvnTest
  Skip Maven tests during package.
.PARAMETER Clean
  Remove downloaded tool archives and re-download.
.EXAMPLE
  .\build-desktop.ps1
  .\build-desktop.ps1 -NoDownload -SkipFrontend
#>
param(
  [switch]$NoDownload,
  [switch]$SkipFrontend,
  [switch]$SkipMvnTest,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $PSCommandPath
$javaRoot = Join-Path $scriptDir ".."
$repoRoot = Join-Path $scriptDir "..\.."
$distDir = Join-Path $scriptDir "dist-desktop"
$iconPath = Join-Path $repoRoot "common\assets\icon.ico"
$toolsDir = Join-Path $scriptDir "tools"
$appName = "WoT Blitz Replay Extractor"

function Write-Step($msg) { Write-Host "[build] $msg" -ForegroundColor Cyan }
function Write-Info($msg) { Write-Host "[info] $msg" -ForegroundColor Gray }
function Write-OK($msg)  { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Err($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

if ($Clean -and (Test-Path "$toolsDir\_downloads")) {
  Remove-Item "$toolsDir\_downloads\*" -Recurse -Force -ErrorAction SilentlyContinue
  Write-Info "Cleaned download cache."
}

New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null

# =====================================================================
#  1. Locate / download JDK 21
# =====================================================================
function Find-Jdk21 {
  $paths = @(
    ,@("$toolsDir\jdk-21\bin\jpackage.exe", "$toolsDir\jdk-21")
  )
  $jdksPath = "$env:USERPROFILE\.jdks"
  if (Test-Path $jdksPath) {
    Get-ChildItem "$jdksPath\jdk-21*" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $paths += ,@("$($_.FullName)\bin\jpackage.exe", $_.FullName)
    }
  }
  if ($env:JAVA_HOME) {
    $paths += ,@("$env:JAVA_HOME\bin\jpackage.exe", $env:JAVA_HOME)
  }
  foreach ($entry in $paths) {
    if (Test-Path $entry[0]) { return $entry[1] }
  }
  return $null
}

function Install-Jdk21 {
  Write-Step "Downloading JDK 21 (Eclipse Temurin)..."
  $url = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse"
  $archive = "$toolsDir\_downloads\jdk21.zip"
  New-Item -ItemType Directory -Path "$toolsDir\_downloads" -Force | Out-Null
  if (-not (Test-Path $archive)) {
    Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
  } else {
    Write-Info "Using cached: $archive"
  }
  Write-Info "Extracting..."
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $toolsDir)
  $jdkDir = Get-ChildItem "$toolsDir\jdk-21*" -Directory | Select-Object -First 1
  if (-not $jdkDir) { throw "JDK 21 extract failed: no jdk-21* directory found." }
  $link = "$toolsDir\jdk-21"
  if (-not (Test-Path $link)) {
    New-Item -ItemType Junction -Path $link -Target $jdkDir.FullName | Out-Null
  }
  Write-OK "JDK 21: $link"
  return $link
}

Write-Step "Checking JDK 21..."
$jdkDir = Find-Jdk21
if (-not $jdkDir) {
  if ($NoDownload) { throw "JDK 21 not found (--NoDownload mode)." }
  $jdkDir = Install-Jdk21
}
Write-OK "JDK 21: $jdkDir"
$env:JAVA_HOME = $jdkDir
$env:Path = "$jdkDir\bin;$env:Path"

# =====================================================================
#  2. Locate / download Maven
# =====================================================================
function Find-Maven {
  if (Test-Path "$toolsDir\maven\bin\mvn.cmd") { return "$toolsDir\maven" }
  if (Get-Command mvn -ErrorAction SilentlyContinue) { return $null }
  return $null
}

function Install-Maven {
  Write-Step "Downloading Maven 3.9.9..."
  $url = "https://dlcdn.apache.org/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.zip"
  $archive = "$toolsDir\_downloads\maven.zip"
  New-Item -ItemType Directory -Path "$toolsDir\_downloads" -Force | Out-Null
  if (-not (Test-Path $archive)) {
    Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
  }
  Write-Info "Extracting..."
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $toolsDir)
  $mvnDir = "$toolsDir\apache-maven-3.9.9"
  $link = "$toolsDir\maven"
  if (-not (Test-Path $link)) {
    New-Item -ItemType Junction -Path $link -Target $mvnDir | Out-Null
  }
  if (-not (Test-Path "$link\bin\mvn.cmd")) { throw "Maven extract failed." }
  Write-OK "Maven: $link"
  return $link
}

Write-Step "Checking Maven..."
$mvnDir = Find-Maven
if ($null -eq $mvnDir) {
  if (-not (Get-Command mvn -ErrorAction SilentlyContinue)) {
    if ($NoDownload) { throw "Maven not found (--NoDownload mode)." }
    $mvnDir = Install-Maven
  } else {
    Write-OK "Maven: system PATH"
  }
}
if ($mvnDir) {
  $env:Path = "$mvnDir\bin;$env:Path"
  Write-OK "Maven: $mvnDir"
}

# =====================================================================
#  3. Locate / download Node.js
# =====================================================================
function Find-NodeJs {
  if (Test-Path "$toolsDir\nodejs\node.exe") { return "$toolsDir\nodejs" }
  if (Get-Command node -ErrorAction SilentlyContinue) { return $null }
  return $null
}

function Install-NodeJs {
  Write-Step "Downloading Node.js 22 LTS..."
  $url = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip"
  $archive = "$toolsDir\_downloads\nodejs.zip"
  New-Item -ItemType Directory -Path "$toolsDir\_downloads" -Force | Out-Null
  if (-not (Test-Path $archive)) {
    Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
  }
  Write-Info "Extracting..."
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $toolsDir)
  $nodeDir = "$toolsDir\node-v22.14.0-win-x64"
  $link = "$toolsDir\nodejs"
  if (-not (Test-Path $link)) {
    New-Item -ItemType Junction -Path $link -Target $nodeDir | Out-Null
  }
  if (-not (Test-Path "$link\node.exe")) { throw "Node.js extract failed." }
  Write-OK "Node.js: $link"
  return $link
}

Write-Step "Checking Node.js..."
$nodeDir = Find-NodeJs
if ($null -eq $nodeDir) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    if ($NoDownload) { throw "Node.js not found (--NoDownload mode)." }
    $nodeDir = Install-NodeJs
  } else {
    Write-OK "Node.js: system PATH"
  }
}
if ($nodeDir) {
  $env:Path = "$nodeDir;$env:Path"
  Write-OK "Node.js: $nodeDir"
}

# ---- Verify all tools ----
Write-Info "Verifying tools..."
$jpackageVer = & jpackage --version 2>&1 | ForEach-Object { "$_" }
Write-Info "  jpackage: $jpackageVer"
$mvnVer = & mvn --version 2>&1 | Select-String "Apache Maven"
Write-Info "  $($mvnVer.Line)"
$nodeVer = & node --version 2>&1
Write-Info "  node: $nodeVer"
$npmVer = & npm --version 2>&1
Write-Info "  npm: $npmVer"

# =====================================================================
#  Build steps
# =====================================================================

if (-not $SkipFrontend) {
  Write-Step "[1/4] Building Vue frontend..."
  Push-Location "$javaRoot\frontend"
  try {
    if (Test-Path "node_modules\.package-lock.json") {
      & npm run build
    } else {
      & npm install
      & npm run build
    }
    if ($LASTEXITCODE -ne 0) { throw "npm build failed." }
  } finally { Pop-Location }
  Write-OK "Frontend built."
} else {
  Write-Step "[1/4] Skipping frontend (--SkipFrontend)..."
}

Write-Step "[2/4] Building Spring Boot jar..."
$mvnArgs = @("-s", "settings.xml", "-pl", "wotb-core,wotb-web", "-am", "clean", "package")
if ($SkipMvnTest) { $mvnArgs += "-DskipTests" }
Push-Location $javaRoot
try {
  & mvn $mvnArgs
  if ($LASTEXITCODE -ne 0) { throw "Maven build failed." }
} finally { Pop-Location }
Write-OK "Jar built."

Write-Step "[3/4] jpackage app-image..."
# Kill any running instance of the app before cleaning
Get-Process -Name "$appName" -ErrorAction SilentlyContinue | Stop-Process -Force
if (Test-Path $distDir) {
  $retries = 3
  do {
    try {
      Remove-Item $distDir -Recurse -Force -ErrorAction Stop
      break
    } catch {
      $retries--
      if ($retries -eq 0) { throw }
      Write-Info "  dist-desktop locked, retrying in 2s..."
      Start-Sleep -Seconds 2
    }
  } while ($true)
}
New-Item -ItemType Directory -Path $distDir -Force | Out-Null

$jpArgs = @(
  "--type", "app-image",
  "--name", $appName,
  "--dest", $distDir,
  "--input", "$javaRoot\wotb-web\target",
  "--main-jar", "wotb-web.jar",
  "--arguments", "--desktop"
)
if (Test-Path $iconPath) {
  $jpArgs += @("--icon", $iconPath)
}
& jpackage $jpArgs
if ($LASTEXITCODE -ne 0) { throw "jpackage failed." }
Write-OK "app-image created."

Write-Step "[4/4] Copying assets..."
$assetsDir = "$distDir\$appName\assets"
New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
if (Test-Path $iconPath) {
  Copy-Item $iconPath "$assetsDir\icon.ico" -Force
}

Write-Host ""
Write-OK "Done: $distDir\$appName\$appName.exe"
Write-Info "Keep the whole folder when moving or zipping."
Write-Host ""

if (-not $Host.UI.RawUI.KeyAvailable) {
  Write-Host "Press any key to exit..." -NoNewline
  $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
