#!/usr/bin/env bash
# Sponsor 运行时内容（配置 + 收款码）**构建期注入** → publicDir（common/assets/）。
#
# 内容从哪来：它是私密收款信息，不进 Git 历史、不进镜像源，但必须出现在**两个发布面**——
# Frontend 镜像（Web 同源伺服）与 APK bundle（本机 origin，赞助页离线也能显示）。做法是
# 复刻本仓既有的 Agent WASM 模式：内容作为 **GitHub Release 资产**发布（`deploy/sponsor/
# content.json` 钉 release/asset/sha256），构建期下载校验后注入 publicDir，由 Vite 原样拷进
# dist（Web）与 dist-android（APK）。仓库里只有 pin（哈希），没有明文内容。
#
# 输入（三选一）：
#   SPONSOR_BUNDLE=<tar.gz 路径>   构建用：pin 住的 release 资产（sponsor-config.json +
#                                  sponsor-assets/ 的相对布局）
#   SPONSOR_SOURCE_DIR=<目录>      本地自测用：同一布局的本地目录
#   都不设置                      absent：不注入、不失败（页面回落「暂未配置」）
#
# 契约（stdout 只输出一行机器可读结果；人读信息走 stderr；**绝不回显内容**）：
#   sponsorRuntimeContent=injected | absent
# 输入坏（tar 逃逸/非普通文件、JSON 形状不符、引用的图片缺失或不是真实图片）→ fail closed。
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PUBLIC_DIR="$ROOT/common/assets"

fail(){ echo "sponsor-inject: FAIL: $*" >&2; exit 1; }
note(){ echo "sponsor-inject: $*" >&2; }

bundle="${SPONSOR_BUNDLE:-}"
source_dir="${SPONSOR_SOURCE_DIR:-}"

if [ -n "$bundle" ] && [ -n "$source_dir" ]; then
  fail "SPONSOR_BUNDLE and SPONSOR_SOURCE_DIR are mutually exclusive"
fi

if [ -z "$bundle" ] && [ -z "$source_dir" ]; then
  # 确定性：没有输入就确保 publicDir 里没有上一次注入的残留（否则「关掉赞助内容」不会真的关掉）。
  rm -f "$PUBLIC_DIR/sponsor-config.json"
  rm -rf "$PUBLIC_DIR/sponsor-assets"
  note "no sponsor input configured: building without sponsor runtime content (sponsor page renders the unconfigured state)"
  echo "sponsorRuntimeContent=absent"
  exit 0
fi

for cmd in python3; do command -v "$cmd" >/dev/null || fail "missing command: $cmd"; done
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

if [ -n "$bundle" ]; then
  [ -f "$bundle" ] || fail "SPONSOR_BUNDLE is not a file: $bundle"
  # 构建上下文来自外部资产 → tar 必须 fail closed：只接受 sponsor-config.json 与
  # sponsor-assets/ 下的普通文件/目录，拒绝符号链接、绝对路径与 .. 逃逸。
  python3 - "$bundle" <<'PY_TAR'
import sys, tarfile

with tarfile.open(sys.argv[1], "r:gz") as archive:
    for member in archive.getmembers():
        name = member.name
        if not (name == "sponsor-config.json" or name == "sponsor-assets" or name.startswith("sponsor-assets/")):
            raise SystemExit(f"unexpected entry in sponsor bundle: {name}")
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"unsupported entry type in sponsor bundle: {name}")
        if name.startswith("/") or ".." in name.split("/"):
            raise SystemExit(f"unsafe entry path in sponsor bundle: {name}")
PY_TAR
  tar -xzf "$bundle" -C "$stage"
  source_dir="$stage"
fi

[ -d "$source_dir" ] || fail "sponsor source directory is missing: $source_dir"
[ -f "$source_dir/sponsor-config.json" ] || fail "missing sponsor-config.json in $source_dir"

python3 - "$source_dir" "$stage" <<'PY_SHAPE'
import json, pathlib, re, shutil, sys

source = pathlib.Path(sys.argv[1])
stage = pathlib.Path(sys.argv[2])
allowed = {"alipay", "wechat"}

try:
    config = json.loads((source / "sponsor-config.json").read_text(encoding="utf-8"))
except ValueError as error:
    raise SystemExit(f"sponsor config is not valid JSON: {error}")

# 与前端 normalizeSponsorConfig 同一形状契约（前端是运行期 SSOT；这里只做构建期 fail-closed，
# 避免把一个「页面必然回落未配置」的坏配置打进两个发布面）。
if not isinstance(config, dict) or not isinstance(config.get("enabled"), bool):
    raise SystemExit("sponsor config must be an object with a boolean enabled flag")
if config["enabled"] is not True:
    # 显式关闭：只注入配置文档本身，未被引用的图片一律不进发布面（页面按设计回落「暂未配置」）。
    if config.get("methods") not in (None, []):
        raise SystemExit("sponsor config is disabled but still declares methods")
    (stage / "out").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / "sponsor-config.json", stage / "out/sponsor-config.json")
    sys.exit(0)
methods = config.get("methods")
if not isinstance(methods, list) or not methods:
    raise SystemExit("enabled sponsor config must declare a non-empty methods list")
(stage / "out").mkdir(parents=True, exist_ok=True)
shutil.copyfile(source / "sponsor-config.json", stage / "out/sponsor-config.json")

# 与前端 normalizeSponsorConfig 的 ASSET_PATH **逐字一致**（前端是运行期 SSOT）：
# 首个字符必须是字母数字，其余只允许 [A-Za-z0-9._-]，且扩展名 ∈ {png, jpg, jpeg, webp}。
# 因此 `../`、子目录、绝对路径在形状一层就被拒。
ASSET_PATH = re.compile(r"^/sponsor-assets/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$", re.IGNORECASE)


def image_format(path):
    """按**内容**判定格式并验证完整性（不做全解码：构建链不引入 Pillow）。

    - PNG：签名 + 末尾必须是 IEND chunk（截断/改名的半截文件在这里被拒）
    - JPEG：FFD8FF 开头 + FFD9 结尾（同上）
    - WebP：RIFF....WEBP 且 RIFF 尺寸字段与真实长度一致（截断必然失配）
    """
    data = path.read_bytes()
    if len(data) < 16:
        return None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png" if data[-8:-4] == b"IEND" else None
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg" if data.endswith(b"\xff\xd9") else None
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        declared = int.from_bytes(data[4:8], "little")
        return "webp" if declared == len(data) - 8 else None
    return None


EXTENSION_FORMAT = {"png": "png", "jpg": "jpeg", "jpeg": "jpeg", "webp": "webp"}
for method in methods:
    if not isinstance(method, dict):
        raise SystemExit("malformed method entry")
    kind = method.get("type")
    image = method.get("image")
    if kind not in allowed:
        raise SystemExit(f"unsupported method type: {kind!r}")
    if not isinstance(image, str) or not ASSET_PATH.match(image):
        raise SystemExit(f"unsafe image path: {image!r}")
    origin = source / image.lstrip("/")
    if not origin.is_file():
        raise SystemExit(f"missing sponsor image for method {kind!r}: {image}")
    detected = image_format(origin)
    declared = EXTENSION_FORMAT[image.rsplit(".", 1)[-1].lower()]
    if detected is None:
        raise SystemExit(f"method {kind!r}: {origin.name} is not a complete PNG/JPEG/WebP image")
    if detected != declared:
        raise SystemExit(
            f"method {kind!r}: {origin.name} declares {declared} but its bytes are {detected}"
        )
    dest = stage / "out" / image.lstrip("/")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(origin, dest)
PY_SHAPE

mkdir -p "$PUBLIC_DIR"
rm -rf "$PUBLIC_DIR/sponsor-assets"
if [ -d "$stage/out/sponsor-assets" ]; then
  cp -R "$stage/out/sponsor-assets" "$PUBLIC_DIR/sponsor-assets"
fi
cp "$stage/out/sponsor-config.json" "$PUBLIC_DIR/sponsor-config.json"

images=0
if [ -d "$PUBLIC_DIR/sponsor-assets" ]; then
  images="$(find "$PUBLIC_DIR/sponsor-assets" -type f | wc -l | tr -d ' ')"
fi
note "injected sponsor runtime content into common/assets/: sponsor-config.json + ${images} image(s)"
echo "sponsorRuntimeContent=injected"
