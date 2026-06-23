@echo off
setlocal
chcp 65001 >nul

REM ??????? PowerShell ?????
set "SCRIPT=%~dpn0.ps1"
if exist "%SCRIPT%" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
    exit /b !ERRORLEVEL!
) else (
    echo [ERROR] build-desktop.ps1 not found in %~dp0
    pause
    exit /b 1
)
