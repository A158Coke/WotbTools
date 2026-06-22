@echo off
REM 构建两个单文件 exe (均内嵌 tankopedia.json 与图标)
chcp 65001 >nul

if not exist icon.ico (
  echo 生成图标 icon.ico ...
  python make_icon.py
)

echo [1/2] 构建图形界面版 wotb_gui.exe ...
python -m PyInstaller --onefile --windowed --name wotb_gui --icon icon.ico --add-data "tankopedia.json;." --add-data "icon.ico;." wotb_gui.py

echo [2/2] 构建命令行版 wotb_extractor.exe ...
python -m PyInstaller --onefile --console --name wotb_extractor --icon icon.ico --add-data "tankopedia.json;." wotb_extractor.py

echo.
echo 构建完成:
echo   dist\wotb_gui.exe        (图形界面, 推荐)
echo   dist\wotb_extractor.exe  (命令行 / 拖拽 / 批量)
pause
