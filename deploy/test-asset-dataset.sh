#!/usr/bin/env bash
# dataset.sh 的 host-side 契约测试（不依赖真实资产包 / 真实 asset_release.py）。
# 覆盖：link/default/rollback 的原子符号链接、audit 追加、versions.json 调用、verify；
# link 的候选 release 内容体检（坏包在切换在线 symlink 之前失败）；
# catalog 的 default 从 current 推导（--default 不一致即拒绝）；
# unlink 的 default 保护与删除语义。
set -Eeuo pipefail

command -v flock >/dev/null || { echo "skip: flock missing (host contract requires util-linux)"; exit 0; }
command -v python3 >/dev/null || { echo "skip: python3 missing"; exit 0; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
root="$tmp/root"
mkdir -p "$root/releases/r1" "$root/releases/r2" "$root/releases/r3" "$root/releases/r4" "$root/datasets" "$root/bin"

cat > "$root/bin/asset_release.py" <<'PY'
import json, os, pathlib, sys
cmd = sys.argv[1] if len(sys.argv) > 1 else ""
args = sys.argv[2:]
def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default
if cmd == "catalog":
    root = pathlib.Path(opt("--root"))
    out = pathlib.Path(opt("--out"))
    items = []
    for child in sorted(root.iterdir()):
        if not (child / "version.json").is_file():
            continue
        version = json.loads((child / "version.json").read_text(encoding="utf-8"))
        items.append({"id": version["dataset_id"], "release": version["release"], "status": "active"})
    out.write_text(json.dumps({"schema": 1, "default": opt("--default") or items[0]["id"], "datasets": items}) + "\n", encoding="utf-8")
elif cmd == "verify":
    pack = opt("--pack")
    if pack:
        # 单 release 体检：manifest 登记的文件必须存在（坏包候选 fail-closed）。
        manifest = json.loads(pathlib.Path(pack, "manifest.json").read_text(encoding="utf-8"))
        for entry in manifest["files"]:
            if not (pathlib.Path(pack) / entry["path"]).exists():
                raise SystemExit(f"manifest 登记的文件不存在: {entry['path']}")
    # --root 模式（dataset 目录批量校验）：stub 一律 pass
else:
    raise SystemExit(f"unexpected command: {cmd}")
PY

for release in r1 r2; do
  cat > "$root/releases/$release/version.json" <<JSON
{"schema":1,"dataset_id":"11.21.0","game_version":"release/11.21.0","variant":null,"label":"11.21.0","release":"$release","generated":"2026-11-01T00:00:00+00:00","content_digest":"sha256:x","manifest_sha256":"y","tank_count":0,"status":"active"}
JSON
  printf '%s\n' '{"version":1,"files":[]}' > "$root/releases/$release/manifest.json"
done
cat > "$root/releases/r3/version.json" <<'JSON'
{"schema":1,"dataset_id":"supertest","game_version":"release/11.21.0","variant":"t11p2","label":"supertest","release":"r3","generated":"2026-11-01T00:00:00+00:00","content_digest":"sha256:x","manifest_sha256":"y","tank_count":0,"status":"active"}
JSON
printf '%s\n' '{"version":1,"files":[]}' > "$root/releases/r3/manifest.json"
# r4：坏包候选——version.json/manifest 齐全（能过元数据检查），但 manifest 登记的文件缺失
cat > "$root/releases/r4/version.json" <<'JSON'
{"schema":1,"dataset_id":"bad","game_version":"release/11.21.0","variant":null,"label":"bad","release":"r4","generated":"2026-11-01T00:00:00+00:00","content_digest":"sha256:x","manifest_sha256":"y","tank_count":0,"status":"active"}
JSON
printf '%s\n' '{"version":1,"files":[{"path":"ghost/missing.json","sha256":"x","bytes":1}]}' > "$root/releases/r4/manifest.json"

run() {
  WOTB_ASSET_ROOT="$root" ASSET_RELEASE_TOOL="$root/bin/asset_release.py" PYTHON=python3 \
    bash "$ROOT_DIR/deploy/assets/dataset.sh" "$@"
}

assert_link() {
  local link="$1" expected="$2"
  local actual
  actual="$(readlink "$link")"
  [[ "$actual" == "$expected" ]] || { echo "expected $link -> $expected, got $actual" >&2; exit 1; }
}

run link --dataset 11.21.0 --release r1 --default >/dev/null
assert_link "$root/datasets/11.21.0" "../releases/r1"
assert_link "$root/current" "datasets/11.21.0"
[[ -f "$root/versions.json" ]] || { echo "versions.json missing" >&2; exit 1; }
grep -q '"action":"link"' "$root/release-log.jsonl" || { echo "audit line missing" >&2; exit 1; }

run link --dataset 11.21.0 --release r2 >/dev/null
assert_link "$root/datasets/11.21.0" "../releases/r2"
assert_link "$root/current" "datasets/11.21.0"

run rollback --dataset 11.21.0 --release r1 >/dev/null
assert_link "$root/datasets/11.21.0" "../releases/r1"

run default --dataset 11.21.0 >/dev/null
assert_link "$root/current" "datasets/11.21.0"

run verify >/dev/null
list_out="$(run list)"
grep -q '11.21.0: release=r1 status=active' <<< "$list_out" || { echo "list output missing dataset" >&2; exit 1; }

# --- link 候选体检：坏包必须在切换在线 symlink 之前失败，在线状态分毫不动 ---
if run link --dataset bad --release r4 >/dev/null 2>&1; then
  echo "link with broken candidate must fail" >&2; exit 1
fi
[[ -e "$root/datasets/bad" ]] && { echo "broken candidate must not create the dataset symlink" >&2; exit 1; }
assert_link "$root/current" "datasets/11.21.0"
grep -q '"id": "bad"' "$root/versions.json" 2>/dev/null && { echo "broken candidate must not enter the catalog" >&2; exit 1; }

# --- unlink: default 指向它时拒绝；非默认删除后目录消失 + 审计 + 目录重算 ---
run link --dataset supertest --release r3 >/dev/null
assert_link "$root/datasets/supertest" "../releases/r3"
run default --dataset supertest >/dev/null
assert_link "$root/current" "datasets/supertest"
if run unlink --dataset supertest >/dev/null 2>&1; then
  echo "unlink of the current default dataset must fail" >&2; exit 1
fi
# catalog 的 default 从 current 推导：--default 与 current 不一致即拒绝
if run catalog --default 11.21.0 >/dev/null 2>&1; then
  echo "catalog --default mismatching current must fail" >&2; exit 1
fi
run default --dataset 11.21.0 >/dev/null
run unlink --dataset supertest --dry-run >/dev/null
[[ -L "$root/datasets/supertest" ]] || { echo "dry-run unlink must not remove the link" >&2; exit 1; }
run unlink --dataset supertest >/dev/null
[[ ! -e "$root/datasets/supertest" ]] || { echo "unlink must remove the dataset symlink" >&2; exit 1; }
grep -q '"action":"unlink"' "$root/release-log.jsonl" || { echo "unlink audit line missing" >&2; exit 1; }
[[ -d "$root/releases/r3" ]] || { echo "unlink must keep the release directory" >&2; exit 1; }

echo "asset dataset host contract: PASS"
