#!/usr/bin/env bash
# 把 android-release 的 staging evidence 原子落位到被服务的目录，并与宿主部署锁互斥。
#
# 为什么必须这样落位（2026-10-09 的真实故障）：
#   publish 只按公开 URL 读证据，而 wotbtools.com 由 Caddy 在 TX1/TX2 之间负载 —— 两台都必须
#   持续可读到它。TX2 的 runtime-content 由 Frontend Replica 在 /opt/wotb-tx2/.deploy.lock 下
#   **整树替换**（并带走既有证据）；scan 与 swap 之间仍有非零窗口（递归删 .previous + 多次
#   sudo），直接 scp 进服务目录会落在窗口里：文件随旧树进 .previous、公开目录缺文件，而同步
#   侧仍报 PASS（无法自证）。同一把锁下的原子 rename 让「安装」和「扫描 → 换树」互斥：
#   证据要么在扫描前就在树里（被带走），要么在换树后写入新树（不再被 .previous 吃掉）。
#   对读取侧（publish / 公开 URL）也顺带消除半截 JSON：中转文件先落盘、再 rename，读者要么
#   看不到、要么看到完整文件。
#
# 锁文件由宿主 deploy owner 提供（缺失即 fail closed，本脚本绝不代建）；目标目录必须是既有的
# 被服务目录（不代建，避免在未就绪的宿主上造出假的公开路径）。
#
# 用法（在目标宿主上执行）：
#   install-staging-evidence.sh --source <中转文件> --dest-dir <被服务目录> --lock <宿主锁>
# 环境：EVIDENCE_LOCK_WAIT_SEC 覆盖等锁上限（默认 900s）。
set -Eeuo pipefail

fail(){ echo "install staging evidence: FAIL: $*" >&2; exit 1; }
for cmd in flock mv chmod sha256sum; do command -v "$cmd" >/dev/null || fail "missing command: $cmd"; done

source_file=''; dest_dir=''; lock_file=''
wait_secs="${EVIDENCE_LOCK_WAIT_SEC:-900}"
while [ $# -gt 0 ]; do
  case "$1" in
    --source) source_file="${2:-}"; shift 2 ;;
    --dest-dir) dest_dir="${2:-}"; shift 2 ;;
    --lock) lock_file="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done
[ -n "$source_file" ] && [ -n "$dest_dir" ] && [ -n "$lock_file" ] \
  || fail "usage: --source <file> --dest-dir <served dir> --lock <host lock>"

# 只搬运证据：名字不对就拒绝，避免把任意文件搬进公开目录。
case "${source_file##*/}" in
  *.staging.json) ;;
  *) fail "refusing to install a non-evidence file: $source_file" ;;
esac
[ -f "$lock_file" ] || fail "host deploy lock is missing (owner-provided, never created here): $lock_file"
[ -w "$lock_file" ] || fail "host deploy lock is not writable by this account: $lock_file"
# 目标目录**不能**在取锁前判：Replica 的 `mv $root → $root.previous` 与 `mv $stage → $root`
# 之间整个树（含被服务目录）短暂不存在（2026-10-09 评审 P2），取锁前判会在那个窗口里直接
# fail 掉，而不是等换树完成。锁与中转文件都在被替换的树之外，所以只有目录检查要后移。
[ -s "$source_file" ] || fail "incoming evidence is missing or empty: $source_file"

name="${source_file##*/}"
dest="$dest_dir/$name"
# nginx 需要 world-readable；rename 会连 mode 一起带过去，所以先在中转文件上设好。
chmod 0644 "$source_file"

exec 9>"$lock_file"
flock -w "$wait_secs" 9 \
  || fail "timed out after ${wait_secs}s waiting for $lock_file (holder diagnostics: .agents/AGENTS.md §TX host lock)"
# 取到锁 = 换树已收尾（本进程不会撞上 swap 中间态）：此刻目录仍缺才是宿主真的未就绪。
[ -d "$dest_dir" ] || fail "served destination directory is missing after acquiring the lock: $dest_dir"
mv -f "$source_file" "$dest"
echo "staging evidence installed: $dest sha256=$(sha256sum "$dest" | awk '{print $1}')"
