@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

set "APP_NAME=WoT Blitz Replay Extractor"
set "ROOT=%~dp0"
set "PROJECT_ROOT=%ROOT%.."
set "DIST=%ROOT%dist-desktop"
set "ICON=%PROJECT_ROOT%\icon.ico"

if exist "%USERPROFILE%\.jdks\jdk-21.0.1\bin\jpackage.exe" (
  set "JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1"
  set "PATH=%JAVA_HOME%\bin;%PATH%"
)

where jpackage >nul 2>nul
if errorlevel 1 (
  echo [ERROR] jpackage not found. Install JDK 21 and make sure jpackage is on PATH.
  exit /b 1
)

where mvn >nul 2>nul
if errorlevel 1 (
  echo [ERROR] mvn not found. Install Maven or put mvn on PATH.
  exit /b 1
)

echo [1/4] Build Vue frontend...
pushd "%ROOT%frontend"
if exist "node_modules\vite\bin\vite.js" (
  node node_modules\vite\bin\vite.js build
) else (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] npm not found and local node_modules are missing. Install Node.js/npm or restore node_modules.
    exit /b 1
  )
  call npm install
  if errorlevel 1 exit /b 1
  call npm run build
)
if errorlevel 1 exit /b 1
popd

echo [2/4] Build Spring Boot jar with embedded frontend...
pushd "%ROOT%"
call mvn -s settings.xml -pl wotb-core,wotb-web -am -DskipTests clean package
if errorlevel 1 exit /b 1
popd

echo [3/4] Create jpackage app image...
if exist "%DIST%" rmdir /s /q "%DIST%"
mkdir "%DIST%"

if exist "%ICON%" (
  jpackage ^
    --type app-image ^
    --name "%APP_NAME%" ^
    --dest "%DIST%" ^
    --input "%ROOT%wotb-web\target" ^
    --main-jar wotb-web.jar ^
    --arguments "--desktop" ^
    --icon "%ICON%"
) else (
  jpackage ^
    --type app-image ^
    --name "%APP_NAME%" ^
    --dest "%DIST%" ^
    --input "%ROOT%wotb-web\target" ^
    --main-jar wotb-web.jar ^
    --arguments "--desktop"
)
if errorlevel 1 exit /b 1

echo [4/4] Copy assets...
mkdir "%DIST%\%APP_NAME%\assets" >nul 2>nul
mkdir "%DIST%\%APP_NAME%\app\config" >nul 2>nul
if exist "%ICON%" copy /Y "%ICON%" "%DIST%\%APP_NAME%\assets\icon.ico" >nul

echo.
echo Done:
echo   %DIST%\%APP_NAME%\%APP_NAME%.exe
echo.
echo Keep the whole "%APP_NAME%" folder together when moving or zipping it.
endlocal
