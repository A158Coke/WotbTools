@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

REM 从 java/offline/ 运行。ROOT=本目录, JAVA_ROOT=java/, REPO_ROOT=仓库根。
set "APP_NAME=WoT Blitz Replay Extractor"
set "ROOT=%~dp0"
set "JAVA_ROOT=%ROOT%.."
set "REPO_ROOT=%ROOT%..\.."
set "DIST=%ROOT%dist-desktop"
set "ICON=%REPO_ROOT%\common\assets\icon.ico"

REM ---- 定位含 jpackage 的 JDK 21: 写死路径 -> JAVA_HOME -> .jdks\jdk-21* ----
set "JDK="
if exist "%USERPROFILE%\.jdks\jdk-21.0.1\bin\jpackage.exe" set "JDK=%USERPROFILE%\.jdks\jdk-21.0.1"
if not defined JDK if exist "%JAVA_HOME%\bin\jpackage.exe" set "JDK=%JAVA_HOME%"
if not defined JDK for /d %%d in ("%USERPROFILE%\.jdks\jdk-21*") do if exist "%%d\bin\jpackage.exe" set "JDK=%%d"
if defined JDK (
  set "JAVA_HOME=!JDK!"
  set "PATH=!JDK!\bin;%PATH%"
)

REM ---- 前置检查(任一缺失则停住报错, 不闪退) ----
where jpackage >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 未找到 jpackage。需要安装 JDK 21^(自带 jpackage, JDK 8 没有^)，
  echo         并让它在 PATH 上，或装到 %%USERPROFILE%%\.jdks\jdk-21.x 。
  goto :die
)
where mvn >nul 2>nul
if errorlevel 1 ( echo [ERROR] 未找到 mvn。请安装 Maven 并加入 PATH。& goto :die )
where npm >nul 2>nul
if errorlevel 1 ( echo [ERROR] 未找到 npm。请安装 Node.js^(含 npm^)。& goto :die )

echo [1/4] 构建前端 (Vue)...
pushd "%JAVA_ROOT%\frontend"
if exist "node_modules\vite\bin\vite.js" (
  call npm run build
) else (
  call npm install
  if errorlevel 1 ( popd & echo [ERROR] npm install 失败^(检查网络/Node 版本^)。& goto :die )
  call npm run build
)
if errorlevel 1 ( popd & echo [ERROR] 前端构建失败。& goto :die )
popd

echo [2/4] 构建 Spring Boot jar (内置前端)...
pushd "%JAVA_ROOT%"
call mvn -s settings.xml -pl wotb-core,wotb-web -am -DskipTests clean package
if errorlevel 1 ( popd & echo [ERROR] Maven 打包失败。& goto :die )
popd

echo [3/4] jpackage 生成 app-image...
if exist "%DIST%" rmdir /s /q "%DIST%"
if exist "%DIST%" ( echo [ERROR] 无法删除 "%DIST%"，可能离线程序仍在运行，请关闭后重试。& goto :die )
mkdir "%DIST%"

if exist "%ICON%" (
  jpackage --type app-image --name "%APP_NAME%" --dest "%DIST%" ^
    --input "%JAVA_ROOT%\wotb-web\target" --main-jar wotb-web.jar ^
    --arguments "--desktop" --icon "%ICON%"
) else (
  jpackage --type app-image --name "%APP_NAME%" --dest "%DIST%" ^
    --input "%JAVA_ROOT%\wotb-web\target" --main-jar wotb-web.jar ^
    --arguments "--desktop"
)
if errorlevel 1 ( echo [ERROR] jpackage 失败。& goto :die )

echo [4/4] 复制资源...
mkdir "%DIST%\%APP_NAME%\assets" >nul 2>nul
if exist "%ICON%" copy /Y "%ICON%" "%DIST%\%APP_NAME%\assets\icon.ico" >nul

echo.
echo 完成: %DIST%\%APP_NAME%\%APP_NAME%.exe
echo 移动/压缩时请保留整个 "%APP_NAME%" 文件夹。
echo.
pause
endlocal
exit /b 0

:die
echo.
echo 构建未完成。请把上面的错误信息发出来排查。
pause
endlocal
exit /b 1
