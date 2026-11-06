#!/usr/bin/env bash
# dataset.sh 的 host-side 契约测试（不依赖真实资产包 / 真实 asset_release.py）。
# 覆盖：link/default/rollback 的原子符号链接、audit 追加、versions.json 调用、verify；
# link 的候选 release 内容体检（--full 哈希：缺文件与同长度篡改都在切换在线
# symlink 之前失败）；catalog 的 default 从 current 推导（所有 catalog 调用必须
# 显式携带 --default，且与 current 一致）；unlink 的 default 保护与删除语义；
# 故障注入（工具缺失 / catalog 或 verify 失败）必须在持锁状态下回滚在线链接与
# versions.json，不能留下线上状态与目录不一致。
set -Eeuo pipefail

command -v flock >/dev/null || { echo "skip: flock missing (host contract requires util-linux)"; exit 0; }
command -v python3 >/dev/null || { echo "skip: python3 missing"; exit 0; }
command -v sha256sum >/dev/null || { echo "skip: sha256sum missing"; exit 0; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
root="$tmp/root"
mkdir -p "$root/releases/r1" "$root/releases/r2" "$root/releases/r3" "$root/releases/r4" "$root/releases/r5" "$root/releases/r6" "$root/datasets" "$root/bin"

cat > "$root/bin/asset_release.py" <<'PY'
import hashlib, json, os, pathlib, sys
cmd = sys.argv[1] if len(sys.argv) > 1 else ""
args = sys.argv[2:]
def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default
if cmd == "catalog":
    if os.environ.get("FAIL_CATALOG") == "1":
        raise SystemExit("injected catalog failure")
    if "--default" not in args:
        # host 契约：dataset.sh 的所有 catalog 调用必须显式携带 current 推导的
        # default——工具本身不读 current，靠调用方传参保持 versions.json 与
        # current 一致。
        raise SystemExit("catalog 必须显式携带 --default")
    root = pathlib.Path(opt("--root"))
    out = pathlib.Path(opt("--out"))
    default = opt("--default")
    items = []
    for child in sorted(root.iterdir()):
        if not (child / "version.json").is_file():
            continue
        version = json.loads((child / "version.json").read_text(encoding="utf-8"))
        items.append({"id": version["dataset_id"], "release": version["release"], "status": "active"})
    if default not in {item["id"] for item in items}:
        raise SystemExit(f"default 不在列表: {default}")
    out.write_text(json.dumps({"schema": 1, "default": default, "datasets": items}) + "\n", encoding="utf-8")
elif cmd == "verify":
    pack = opt("--pack")
    if pack:
        full = "--full" in args
        manifest = json.loads(pathlib.Path(pack, "manifest.json").read_text(encoding="utf-8"))
        for entry in manifest["files"]:
            f = pathlib.Path(pack) / entry["path"]
            if not f.exists():
                raise SystemExit(f"manifest 登记的文件不存在: {entry['path']}")
            if full:
                digest = hashlib.sha256(f.read_bytes()).hexdigest()
                if digest != entry["sha256"]:
                    raise SystemExit(f"sha256 不符: {entry['path']}")
    # --root 模式（dataset 目录批量校验）：stub 一律 pass，除非注入失败
    else:
        if os.environ.get("FAIL_VERIFY_ROOT") == "1":
            raise SystemExit("injected root verify failure")
else:
    raise SystemExit(f"unexpected command: {cmd}")
PY

make_release() {  # make_release <dir> <dataset_id> <content>
  cat > "$1/version.json" <<JSON
{"schema":1,"dataset_id":"$2","game_version":"release/11.21.0","variant":null,"label":"$2","release":"$(basename "$1")","generated":"2026-11-01T00:00:00+00:00","content_digest":"sha256:x","manifest_sha256":"y","tank_count":0,"status":"active"}
JSON
  printf '%s\n' "$3" > "$1/payload.txt"
  local sha; sha="$(sha256sum "$1/payload.txt" | awk '{print $1}')"
  printf '%s\n' "{\"version\":1,\"files\":[{\"path\":\"payload.txt\",\"sha256\":\"$sha\",\"bytes\":$(wc -c < "$1/payload.txt")}]}" > "$1/manifest.json"
}

make_release "$root/releases/r1" "11.21.0" "payload-r1"
make_release "$root/releases/r2" "11.21.0" "payload-r2"
make_release "$root/releases/r3" "supertest" "payload-r3"
# r4：坏包候选——manifest 登记的文件缺失（存在性体检即可拦截）
cat > "$root/releases/r4/version.json" <<'JSON'
{"schema":1,"dataset_id":"bad","game_version":"release/11.21.0","variant":null,"label":"bad","release":"r4","generated":"2026-11-01T00:00:00+00:00","content_digest":"sha256:x","manifest_sha256":"y","tank_count":0,"status":"active"}
JSON
printf '%s\n' '{"version":1,"files":[{"path":"ghost/missing.json","sha256":"x","bytes":1}]}' > "$root/releases/r4/manifest.json"
# r5：同长度内容篡改——文件存在（存在性体检放行），仅 --full 哈希能拦截
make_release "$root/releases/r5" "evil" "payload-good-good"
printf 'payload-evil-evil' > "$root/releases/r5/payload.txt"
make_release "$root/releases/r6" "supertest" "payload-r6"

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

assert_catalog_default() {  # assert_catalog_default <expected>
  python3 - "$root/versions.json" "$1" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
assert doc["default"] == sys.argv[2], f"catalog.default={doc['default']} != current={sys.argv[2]}"
PY
}

run link --dataset 11.21.0 --release r1 --default >/dev/null
assert_link "$root/datasets/11.21.0" "../releases/r1"
assert_link "$root/current" "datasets/11.21.0"
[[ -f "$root/versions.json" ]] || { echo "versions.json missing" >&2; exit 1; }
grep -q '"action":"link"' "$root/release-log.jsonl" || { echo "audit line missing" >&2; exit 1; }
assert_catalog_default "11.21.0"

run link --dataset 11.21.0 --release r2 >/dev/null
assert_link "$root/datasets/11.21.0" "../releases/r2"
assert_link "$root/current" "datasets/11.21.0"
assert_catalog_default "11.21.0"

run rollback --dataset 11.21.0 --release r1 >/dev/null
assert_link "$root/datasets/11.21.0" "../releases/r1"

run default --dataset 11.21.0 >/dev/null
assert_link "$root/current" "datasets/11.21.0"

run verify >/dev/null
list_out="$(run list)"
grep -q '11.21.0: release=r1 status=active' <<< "$list_out" || { echo "list output missing dataset" >&2; exit 1; }

# --- link 候选体检（--full）：缺文件与同长度篡改都在切换在线 symlink 之前失败 ---
if run link --dataset bad --release r4 >/dev/null 2>&1; then
  echo "link with missing-file candidate must fail" >&2; exit 1
fi
[[ -e "$root/datasets/bad" ]] && { echo "broken candidate must not create the dataset symlink" >&2; exit 1; }
assert_link "$root/current" "datasets/11.21.0"
grep -q '"id": "bad"' "$root/versions.json" 2>/dev/null && { echo "broken candidate must not enter the catalog" >&2; exit 1; }

if run link --dataset evil --release r5 >/dev/null 2>&1; then
  echo "link with same-length corrupted candidate must fail (--full)" >&2; exit 1
fi
[[ -e "$root/datasets/evil" ]] && { echo "corrupted candidate must not create the dataset symlink" >&2; exit 1; }

# --- unlink: default 指向它时拒绝；非默认删除后目录消失 + 审计 + 目录重算 ---
run link --dataset supertest --release r3 >/dev/null
assert_link "$root/datasets/supertest" "../releases/r3"
run default --dataset supertest >/dev/null
assert_link "$root/current" "datasets/supertest"
# default 切换后 catalog.default 必须跟随 current（host 契约：两者是同一事实）
assert_catalog_default "supertest"
if run unlink --dataset supertest >/dev/null 2>&1; then
  echo "unlink of the current default dataset must fail" >&2; exit 1
fi
# catalog 的 default 从 current 推导：--default 与 current 不一致即拒绝
if run catalog --default 11.21.0 >/dev/null 2>&1; then
  echo "catalog --default mismatching current must fail" >&2; exit 1
fi
run default --dataset 11.21.0 >/dev/null
assert_catalog_default "11.21.0"
run unlink --dataset supertest --dry-run >/dev/null
[[ -L "$root/datasets/supertest" ]] || { echo "dry-run unlink must not remove the link" >&2; exit 1; }
run unlink --dataset supertest >/dev/null
[[ ! -e "$root/datasets/supertest" ]] || { echo "unlink must remove the dataset symlink" >&2; exit 1; }
grep -q '"action":"unlink"' "$root/release-log.jsonl" || { echo "unlink audit line missing" >&2; exit 1; }
[[ -d "$root/releases/r3" ]] || { echo "unlink must keep the release directory" >&2; exit 1; }
assert_catalog_default "11.21.0"

# --- 故障注入：模拟缺失依赖与 catalog/verify 失败，在线状态必须原样恢复 ---
run link --dataset supertest --release r3 >/dev/null
cat_before="$(sha256sum "$root/versions.json" | awk '{print $1}')"

# 缺工具：unlink 必须在 rm 之前 fail-closed（旧实现是 rm 后才 require_tool）
mv "$root/bin/asset_release.py" "$root/bin/asset_release.py.off"
if run unlink --dataset supertest >/dev/null 2>&1; then
  echo "unlink without the tool must fail before removing the link" >&2; exit 1
fi
[[ -L "$root/datasets/supertest" ]] || { echo "missing tool must not remove the dataset link" >&2; exit 1; }
mv "$root/bin/asset_release.py.off" "$root/bin/asset_release.py"

# catalog 失败：default 不改变 current，catalog 原样恢复
if FAIL_CATALOG=1 run default --dataset supertest >/dev/null 2>&1; then
  echo "default with a failing catalog must fail" >&2; exit 1
fi
assert_link "$root/current" "datasets/11.21.0"
[[ "$(sha256sum "$root/versions.json" | awk '{print $1}')" == "$cat_before" ]]   || { echo "failed default must restore versions.json" >&2; exit 1; }

# catalog 失败：unlink 恢复被删的 dataset 链接
if FAIL_CATALOG=1 run unlink --dataset supertest >/dev/null 2>&1; then
  echo "unlink with a failing catalog must fail" >&2; exit 1
fi
assert_link "$root/datasets/supertest" "../releases/r3"
[[ "$(sha256sum "$root/versions.json" | awk '{print $1}')" == "$cat_before" ]]   || { echo "failed unlink must restore versions.json" >&2; exit 1; }

# catalog 失败（link --default）：dataset 与 current 都必须回到原目标
if FAIL_CATALOG=1 run link --dataset supertest --release r6 --default >/dev/null 2>&1; then
  echo "link --default with a failing catalog must fail" >&2; exit 1
fi
assert_link "$root/datasets/supertest" "../releases/r3"
assert_link "$root/current" "datasets/11.21.0"
[[ "$(sha256sum "$root/versions.json" | awk '{print $1}')" == "$cat_before" ]]   || { echo "failed link --default must restore versions.json" >&2; exit 1; }

# verify 失败（link，catalog 已写入）：release 链接与 catalog 都要恢复
if FAIL_VERIFY_ROOT=1 run link --dataset 11.21.0 --release r2 >/dev/null 2>&1; then
  echo "link with a failing post-verify must fail" >&2; exit 1
fi
assert_link "$root/datasets/11.21.0" "../releases/r1"
[[ "$(sha256sum "$root/versions.json" | awk '{print $1}')" == "$cat_before" ]]   || { echo "failed post-verify must restore versions.json" >&2; exit 1; }
if compgen -G "$root/.versions.json.*.rollback" >/dev/null; then
  echo "rollback snapshot must not be left behind" >&2; exit 1
fi

# 故障注入之后正常路径仍然工作
run unlink --dataset supertest >/dev/null
assert_catalog_default "11.21.0"

echo "asset dataset host contract: PASS"
