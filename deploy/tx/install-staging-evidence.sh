#!/usr/bin/env bash
# 把 android-release 的 staging evidence 原子落位到被服务的目录，并与宿主部署锁互斥。
#
# 为什么必须这样落位（2026-10-09 的真实故障）：
#   wotbtools.com 由 Caddy 在 TX1/TX2 之间负载 —— 两台都必须
#   持续可读到它。TX2 的 runtime-content 由 Frontend Replica 在 /opt/wotb-tx2/.deploy.lock 下
#   **整树替换**（并带走既有证据）；scan 与 swap 之间仍有非零窗口（递归删 .previous + 多次
#   sudo），直接 scp 进服务目录会落在窗口里：文件随旧树进 .previous、公开目录缺文件，而同步
#   侧仍报 PASS（无法自证）。同一把锁下的原子落位让「安装」和「扫描 → 换树」互斥：
#   证据要么在扫描前就在树里（被带走），要么在换树后写入新树（不再被 .previous 吃掉）。
#   对读取侧（publish / 公开 URL）也顺带消除半截 JSON：目标目录临时文件写完后以硬链接落位，读者要么
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
for cmd in flock ln chmod sha256sum stat mktemp cp cmp; do command -v "$cmd" >/dev/null || fail "missing command: $cmd"; done

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
  *.staging.json) kind=evidence ;;
  wotbtools-android-delta-*.vcdiff)
    [[ "${source_file##*/}" =~ ^wotbtools-android-delta-[0-9]+-[0-9]+-[0-9a-f]{64}\.vcdiff$ ]] \
      || fail "invalid immutable delta name: $source_file"
    kind=delta ;;
  *) fail "refusing to install a non-evidence file: $source_file" ;;
esac
[ -f "$lock_file" ] || fail "host deploy lock is missing (owner-provided, never created here): $lock_file"
[ -w "$lock_file" ] || fail "host deploy lock is not writable by this account: $lock_file"
# 目标目录**不能**在取锁前判：Replica 的 `mv $root → $root.previous` 与 `mv $stage → $root`
# 之间整个树（含被服务目录）短暂不存在（2026-10-09 评审 P2），取锁前判会在那个窗口里直接
# fail 掉，而不是等换树完成。锁与中转文件都在被替换的树之外，所以只有目录检查要后移。
[ -f "$source_file" ] && [ ! -L "$source_file" ] && [ -s "$source_file" ] \
  || fail "incoming evidence is missing, empty or not a regular file: $source_file"

name="${source_file##*/}"
dest="$dest_dir/$name"
exec 9>"$lock_file"
flock -w "$wait_secs" 9 \
  || fail "timed out after ${wait_secs}s waiting for $lock_file (holder diagnostics: deploy/tx/with-deploy-lock.sh)"
# 取到锁 = 换树已收尾（本进程不会撞上 swap 中间态）：此刻目录仍缺才是宿主真的未就绪。
[ -d "$dest_dir" ] || fail "served destination directory is missing after acquiring the lock: $dest_dir"
# 不得把被服务的产物当作可删除的中转文件（包括硬链接别名）。
[ ! "$source_file" -ef "$dest" ] || fail "incoming scratch aliases the served artifact: $source_file"
# 先复制到目标文件系统的临时文件；后续校验和发布消费同一份字节。
tmp="$(mktemp "$dest_dir/.android-evidence.XXXXXXXX")"
trap 'rm -f -- "$tmp"' EXIT
cp -- "$source_file" "$tmp"
chmod 0644 "$tmp"
if [ "$kind" = delta ]; then
  expected="${name%.vcdiff}"; expected="${expected##*-}"
  actual="$(sha256sum "$tmp" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || fail "incoming delta does not match its content-addressed name"
  # 保留不可变补丁但限制每台节点总占用；超限时由 stage 选择完整包，不删除已有证据。
  # 1 GiB 约可容纳两组实测补丁中较大值的 200 份；达到上限后需运维明确处理保留策略。
  if [ ! -e "$dest" ]; then
    total=0
    for existing in "$dest_dir"/wotbtools-android-delta-*.vcdiff; do
      [ -f "$existing" ] || continue
      size="$(stat -c '%s' "$existing")"
      [[ "$size" =~ ^[0-9]+$ ]] || fail "invalid existing delta size: $existing"
      total=$((total + size))
      [ "$total" -le 1073741824 ] || fail "immutable delta storage limit exceeded"
    done
    incoming_size="$(stat -c '%s' "$tmp")"
    [[ "$incoming_size" =~ ^[0-9]+$ ]] || fail "invalid incoming delta size"
    [ "$incoming_size" -le $((1073741824 - total)) ] || fail "immutable delta storage limit exceeded"
  fi
fi
# 复制到目标文件系统上的临时文件，再用硬链接原子 no-clobber 落位；跨文件系统也可安全使用。
if ! ln -T -- "$tmp" "$dest" 2>/dev/null; then
  [ -f "$dest" ] && [ ! -L "$dest" ] && cmp -s "$tmp" "$dest" \
    || fail "immutable $kind conflict: $dest"
fi
rm -f -- "$source_file"
echo "staging artifact installed: $dest sha256=$(sha256sum "$dest" | awk '{print $1}')"
