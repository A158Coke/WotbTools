@echo off
REM 构建两个单文件 exe (均内嵌 tankopedia.json 与图标)。从 python/ 目录运行。
REM 共享资源在 ..\common (tankopedia.json 与 assets\icon.ico)。
chcp 65001 >nul

set "COMMON=..\common"
set "ICON=%COMMON%\assets\icon.ico"
set "TANKS=%COMMON%\tankopedia.json"
set "RATING=%COMMON%\rating.json"

if not exist "%ICON%" (
  echo 生成图标 icon.ico ...
  python make_icon.py
)

echo [1/2] 构建图形界面版 wotb_gui.exe ...
python -m PyInstaller --onefile --windowed --name wotb_gui --icon "%ICON%" --add-data "%TANKS%;." --add-data "%RATING%;." --add-data "%ICON%;." wotb_gui.py

echo [2/2] 构建命令行版 wotb_extractor.exe ...
python -m PyInstaller --onefile --console --name wotb_extractor --icon "%ICON%" --add-data "%TANKS%;." --add-data "%RATING%;." wotb_extractor.py

echo.
echo 构建完成:
echo   dist\wotb_gui.exe        (图形界面, 推荐)
echo   dist\wotb_extractor.exe  (命令行 / 拖拽 / 批量)
pause
