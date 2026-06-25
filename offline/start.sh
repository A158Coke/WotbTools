#!/usr/bin/env bash
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'

echo "========================================"
echo "  WoTBTools — 坦克世界闪击战工具集"
echo "========================================"
echo ""

OS="unknown"
case "$(uname -s)" in
  Darwin) OS="macOS" ;;
  Linux)  OS="Linux" ;;
  MINGW*|MSYS*|CYGWIN*) OS="Windows (Git Bash)" ;;
esac
echo -e "[*] 检测到系统: $OS"
echo ""

if command -v docker &> /dev/null; then
    if docker info &> /dev/null; then
        echo -e "${GREEN}[OK]${NC} Docker 已就绪"
        echo ""
    else
        echo -e "${YELLOW}[!] Docker 已安装但未启动，请启动 Docker Desktop 后重试。${NC}"
        exit 1
    fi
else
    echo -e "${RED}[X] 未检测到 Docker${NC}"
    echo ""
    echo "   Docker 是运行本工具的前提。是否自动安装 Docker？"
    read -p "   [Y] 自动安装  [N] 退出 (y/n): " answer
    case "$answer" in
      [Yy]*) ;;
      *) echo ""; echo "已取消。本工具依赖 Docker，安装后可重新运行。"; exit 0 ;;
    esac

    echo ""
    echo "[*] 正在安装 Docker ..."
    case "$OS" in
      macOS)
        if command -v brew &> /dev/null; then
            brew install --cask docker
            echo ""; echo -e "${GREEN}[OK] Docker Desktop 安装完成。${NC}"
        else
            echo -e "${RED}[X] 未检测到 Homebrew。${NC}"
            echo "    请手动下载: https://www.docker.com/products/docker-desktop/"
            exit 1
        fi
        ;;
      Linux)
        curl -fsSL https://get.docker.com | sh
        echo ""; echo -e "${GREEN}[OK] Docker 安装完成。${NC}"
        sudo usermod -aG docker "$USER" 2>/dev/null || true
        ;;
      *) echo "    请手动下载: https://www.docker.com/products/docker-desktop/"; exit 1 ;;
    esac
    echo -e "${YELLOW}[!!!] 请启动 Docker Desktop 后重新运行本脚本。${NC}"
    exit 0
fi

echo "[*] 正在拉取最新镜像 ..."
docker pull a158coke/wotbtool:backend-latest
docker pull a158coke/wotbtool:frontend-latest

echo "[*] 正在启动服务 ..."
cd "$(dirname "$0")"
docker compose up -d

echo ""
echo -e "${GREEN}[OK] 启动成功！${NC}"
echo "    访问地址: http://localhost:8088"
echo "    停止: docker compose down"
echo "    更新: docker compose pull && docker compose up -d"
echo ""

case "$OS" in
  macOS)   open http://localhost:8088 2>/dev/null || true ;;
  Linux)   xdg-open http://localhost:8088 2>/dev/null || true ;;
esac
