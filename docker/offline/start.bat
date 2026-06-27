@echo off
chcp 65001 >nul
title WoTBTools
setlocal enabledelayedexpansion

echo ========================================
echo   WoTBTools — 坦克世界闪击战工具集
echo ========================================
echo.
echo [*] 检测到系统: Windows
echo.

:: 检查 Docker 是否安装
where docker >nul 2>&1
if %errorlevel% equ 0 goto :docker_running

echo [X] 未检测到 Docker
echo.
echo    Docker 是运行本工具的前提。是否自动安装 Docker Desktop？
echo.
choice /c yn /m "   [Y] 自动安装  [N] 退出"

if errorlevel 2 goto :no_docker
if errorlevel 1 goto :install_docker

:install_docker
echo.
echo [*] 正在通过 winget 安装 Docker Desktop ...
winget install Docker.DockerDesktop --accept-package-agreements --accept-source-agreements 2>nul
if %errorlevel% equ 0 (
    echo.
    echo [OK] Docker Desktop 安装完成。
    echo [!!!] 请手动启动 Docker Desktop，然后重新运行本脚本。
    echo       安装后首次启动可能需要重启系统。
    pause
    exit /b 0
)
echo [X] winget 安装失败（可能系统不支持 winget）。
echo     请手动下载安装：https://www.docker.com/products/docker-desktop/
pause
exit /b 1

:no_docker
echo.
echo 已取消。本工具依赖 Docker，安装后可重新运行。
pause
exit /b 0

:docker_running
docker info >nul 2>&1
if %errorlevel% equ 0 goto :pull

echo [X] Docker 已安装但未启动
echo     请启动 Docker Desktop 后重试。
pause
exit /b 1

:pull
echo [OK] Docker 已就绪
echo.
echo [*] 正在拉取最新镜像 ...
docker pull a158coke/wotbtool:backend-latest
if %errorlevel% neq 0 (
    echo [X] 拉取后端镜像失败，请检查网络。
    pause
    exit /b 1
)

docker pull a158coke/wotbtool:frontend-latest
if %errorlevel% neq 0 (
    echo [X] 拉取前端镜像失败，请检查网络。
    pause
    exit /b 1
)

echo [*] 正在启动服务 ...
cd /d "%~dp0"
docker compose up -d
if %errorlevel% neq 0 (
    echo [X] 启动失败，请检查 Docker 状态。
    pause
    exit /b 1
)

echo.
echo [OK] 启动成功！
echo     访问地址: http://localhost:8088
echo.
echo   常用命令:
echo     停止服务:  docker compose down
echo     更新重启:  docker compose pull ^&^& docker compose up -d
echo.
start http://localhost:8088
pause
