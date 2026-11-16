#!/usr/bin/env bash
# Host-side dataset release management for the Alibaba asset origin.
#
# The release directory is staged first (scp changed files, cp -al from the previous
# release, overlay with `cp --remove-destination`, refresh manifest.json), then this
# script flips the dataset symlink and regenerates versions.json atomically.
#
# Layout:
#   /srv/wotb-assets/
#     releases/<release-id>/         # immutable, staged by the publisher
#     datasets/<dataset-id> -> ../releases/<release-id>
#     current -> datasets/<default-id>
#     versions.json
#     release-log.jsonl
#
# Requires: bash, coreutils (ln/mv -T/readlink), flock, python3, and
# /srv/wotb-assets/bin/asset_release.py (copied from WoT-Blitz-Agent tools/).
#
# Failure semantics: every mutating command preflights its dependencies (tool,
# candidate release, target symlinks) *before* touching the live tree, snapshots
# versions.json, and restores the previous symlinks + catalog while still holding
# the lock if switch/catalog/verify fails. A failed command therefore leaves the
# served state exactly as it was.
#
# Usage:
#   dataset.sh link --dataset 11.21.0 --release 20261105-3f9a2c1b [--default] [--dry-run]
#   dataset.sh default --dataset 11.21.0 [--dry-run]
#   dataset.sh catalog [--default <id>] [--dry-run]   # default 从 current 推导，仅作校验
#   dataset.sh rollback --dataset 11.21.0 --release 20261015-aaaaaaaa [--dry-run]
#   dataset.sh unlink --dataset 11.21.0 [--redirect-to <active-id>] [--dry-run]
#   dataset.sh list
#   dataset.sh verify [--full]
set -Eeuo pipefail

ROOT="${WOTB_ASSET_ROOT:-/srv/wotb-assets}"
RELEASES="$ROOT/releases"
DATASETS="$ROOT/datasets"
CATALOG="$ROOT/versions.json"
AUDIT="$ROOT/release-log.jsonl"
TOOL="${ASSET_RELEASE_TOOL:-$ROOT/bin/asset_release.py}"
PYTHON="${PYTHON:-python3}"
# `_` = client SmartDLC slot naming (s11.21.0_1.yaml -> 11.21.0_1); mirrors asset_release.py
DATASET_ID_RE='^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'

CATALOG_SNAPSHOT=""

die() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "[dataset] $*"; }

cleanup_snapshot() {
  [[ -n "$CATALOG_SNAPSHOT" && -f "$CATALOG_SNAPSHOT" ]] && rm -f "$CATALOG_SNAPSHOT"
  return 0
}
trap cleanup_snapshot EXIT

# 从 current 符号链接推导默认 dataset（工具本身不读 current，需调用方显式传参）。
# 必须在持锁状态下调用。
current_default() {
  local t
  t="$(readlink "$ROOT/current" 2>/dev/null || true)"
  if [[ -n "$t" && "$t" == datasets/* ]]; then
    printf "%s" "${t#datasets/}"
  fi
}

usage() {
  sed -n '/^# Usage:/,/^set -Eeuo pipefail/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d'
  exit "${1:-0}"
}

require_tool() {
  [[ -f "$TOOL" ]] || die "缺少 $TOOL（从 WoT-Blitz-Agent 复制 tools/asset_release.py 到 $ROOT/bin/）"
  command -v "$PYTHON" >/dev/null || die "缺少 $PYTHON"
}

require_dataset() {
  [[ "$1" =~ $DATASET_ID_RE ]] || die "dataset_id 非法: $1"
}

with_lock() {
  command -v flock >/dev/null || die "缺少 flock（util-linux），并发发布会损坏 current/versions.json"
  exec 9>"$ROOT/.publish.lock"
  flock 9
}

audit() {
  local action="$1" dataset="$2" release="$3" previous="$4"
  printf '{"time":"%s","action":"%s","dataset":"%s","release":"%s","previous":"%s","actor":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$dataset" "$release" "$previous" "${SUDO_USER:-${USER:-unknown}}" \
    >> "$AUDIT"
}

verify_release() {
  local dataset="$1" release="$2"
  local release_dir="$RELEASES/$release"
  [[ -d "$release_dir" ]] || die "release 不存在: $release_dir"
  [[ -f "$release_dir/version.json" ]] || die "release 缺 version.json: $release_dir"
  [[ -f "$release_dir/manifest.json" ]] || die "release 缺 manifest.json: $release_dir"
  local declared
  declared="$("$PYTHON" -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["dataset_id"])' "$release_dir/version.json")"
  [[ "$declared" == "$dataset" ]] || die "release 的 dataset_id ($declared) 与目标 ($dataset) 不一致"
}

# 目标必须是"不存在"或"符号链接"：真实目录/文件不能静默覆盖。
require_link_target() {
  local link="$1"
  [[ ! -e "$link" || -L "$link" ]] \
    || die "$link 已存在且不是符号链接（拒绝覆盖真实目录；先人工确认再清理）"
}

switch_symlink() {
  local link="$1" target="$2" dry_run="$3"
  if [[ "$dry_run" == "1" ]]; then
    note "would link $link -> $target"
    return 0
  fi
  [[ ! -e "$link" || -L "$link" ]] || return 1
  # 首次发布/旧布局迁移时 datasets/ 可能尚不存在：先建父目录，再原子切换。
  [[ -d "$(dirname "$link")" ]] || mkdir -p "$(dirname "$link")" || return 1
  ln -sfn "$target" "$link.new" && mv -T "$link.new" "$link"
}

# 把链接恢复为原目标；空目标 = 原先不存在，删除它。
restore_symlink() {
  local link="$1" previous="$2"
  if [[ -z "$previous" ]]; then
    rm -f "$link"
    return 0
  fi
  ln -sfn "$previous" "$link.new" && mv -T "$link.new" "$link"
}

# 在改动在线状态之前备份 versions.json：catalog 写失败时用它恢复目录。
snapshot_catalog() {
  if [[ -f "$CATALOG" ]]; then
    CATALOG_SNAPSHOT="$ROOT/.versions.json.$$.rollback"
    cp -p "$CATALOG" "$CATALOG_SNAPSHOT" || die "无法备份 $CATALOG（未改动在线状态）"
  fi
}

restore_catalog() {
  if [[ -n "$CATALOG_SNAPSHOT" ]]; then
    mv -f "$CATALOG_SNAPSHOT" "$CATALOG" || return 1
    CATALOG_SNAPSHOT=""
    return 0
  fi
  rm -f "$CATALOG"
}

# 回滚一组在线改动（成对的 link previous）；回滚本身失败必须显式报告。
rollback_online() {
  local ok=0
  local link previous
  while [[ $# -gt 0 ]]; do
    link="$1"; previous="$2"; shift 2
    restore_symlink "$link" "$previous" || { note "WARNING: 无法恢复 $link"; ok=1; }
  done
  restore_catalog || { note "WARNING: 无法恢复 $CATALOG"; ok=1; }
  [[ "$ok" == "0" ]] || note "WARNING: 回滚未完全成功，请人工核对 $ROOT"
}

cmd_link() {
  local dataset="" release="" make_default=0 dry_run=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dataset) dataset="$2"; shift 2 ;;
      --release) release="$2"; shift 2 ;;
      --default) make_default=1; shift ;;
      --dry-run) dry_run=1; shift ;;
      *) die "未知参数: $1" ;;
    esac
  done
  require_dataset "$dataset"
  [[ -n "$release" ]] || die "缺 --release"
  # 工具与候选 release 内容体检都必须在改动任何在线链接之前完成：
  # 候选是坏包时直接失败，正在服务的 dataset 不受影响（review P1）。
  require_tool
  with_lock
  verify_release "$dataset" "$release"
  # --full：逐文件 sha256。存在性检查挡不住同长度内容篡改（review 复现：
  # good→evil 同长度替换后 verify --pack 返回 0、current 立即读到坏内容），
  # 切换在线 symlink 之前必须做完整哈希。
  "$PYTHON" "$TOOL" verify --pack "$RELEASES/$release" --full \
    || die "候选 release 内容校验失败：$RELEASES/$release（未切换在线 dataset）"

  local link="$DATASETS/$dataset"
  require_link_target "$link"
  local previous
  previous="$(readlink "$link" 2>/dev/null || true)"
  local previous_current=""
  if [[ "$make_default" == "1" ]]; then
    require_link_target "$ROOT/current"
    previous_current="$(readlink "$ROOT/current" 2>/dev/null || true)"
  fi
  # catalog 的 default 必须显式传（工具不读 current）；在改动前就确定，缺失即
  # fail-closed，不能等链接切完才发现无法生成目录。
  local catalog_default
  if [[ "$make_default" == "1" ]]; then
    catalog_default="$dataset"
  else
    catalog_default="$(current_default)"
    [[ -n "$catalog_default" ]] || die "无法确定 catalog default（current 缺失或仍是旧式 releases/<id>）；首次发布/迁移请用 dataset.sh link --dataset <id> --release <release> --default"
  fi

  if [[ "$dry_run" == "1" ]]; then
    switch_symlink "$link" "../releases/$release" 1
    [[ "$make_default" == "1" ]] && switch_symlink "$ROOT/current" "datasets/$dataset" 1
    note "dataset=$dataset release=$release default=$make_default"
    return 0
  fi

  # 从这里开始改动在线状态：依赖已 preflight、catalog 已备份。
  snapshot_catalog
  if ! switch_symlink "$link" "../releases/$release" 0; then
    rollback_online "$link" "$previous"
    die "切换 $link 失败（在线状态已回滚）"
  fi
  if [[ "$make_default" == "1" ]] && ! switch_symlink "$ROOT/current" "datasets/$dataset" 0; then
    rollback_online "$link" "$previous"
    die "切换 current 失败（在线状态已回滚）"
  fi

  if ! "$PYTHON" "$TOOL" catalog --root "$DATASETS" --out "$CATALOG" --default "$catalog_default"; then
    if [[ "$make_default" == "1" ]]; then
      rollback_online "$link" "$previous" "$ROOT/current" "$previous_current"
    else
      rollback_online "$link" "$previous"
    fi
    die "versions.json 生成失败（在线状态已回滚）"
  fi
  if ! "$PYTHON" "$TOOL" verify --root "$DATASETS" --catalog "$CATALOG"; then
    if [[ "$make_default" == "1" ]]; then
      rollback_online "$link" "$previous" "$ROOT/current" "$previous_current"
    else
      rollback_online "$link" "$previous"
    fi
    die "发布后 verify 失败（在线状态已回滚）"
  fi
  audit "link" "$dataset" "$release" "$previous"
  note "dataset=$dataset release=$release default=$make_default"
}

cmd_default() {
  local dataset="" dry_run=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dataset) dataset="$2"; shift 2 ;;
      --dry-run) dry_run=1; shift ;;
      *) die "未知参数: $1" ;;
    esac
  done
  require_dataset "$dataset"
  # 依赖与目标全部在持锁后、改动前验证：工具缺失时不能先把 current 切走。
  require_tool
  with_lock
  [[ -e "$DATASETS/$dataset" ]] || die "dataset 不存在: $DATASETS/$dataset"
  require_link_target "$ROOT/current"

  local previous
  previous="$(readlink "$ROOT/current" 2>/dev/null || true)"
  if [[ "$dry_run" == "1" ]]; then
    switch_symlink "$ROOT/current" "datasets/$dataset" 1
    note "default dataset=$dataset"
    return 0
  fi

  snapshot_catalog
  if ! switch_symlink "$ROOT/current" "datasets/$dataset" 0; then
    rollback_online "$ROOT/current" "$previous"
    die "切换 current 失败（在线状态已回滚）"
  fi
  if ! "$PYTHON" "$TOOL" catalog --root "$DATASETS" --out "$CATALOG" --default "$dataset"; then
    rollback_online "$ROOT/current" "$previous"
    die "versions.json 生成失败（current 已回滚）"
  fi
  if ! "$PYTHON" "$TOOL" verify --root "$DATASETS" --catalog "$CATALOG"; then
    rollback_online "$ROOT/current" "$previous"
    die "发布后 verify 失败（current 已回滚）"
  fi
  audit "default" "$dataset" "$(readlink "$DATASETS/$dataset")" "$previous"
  note "default dataset=$dataset"
}

cmd_catalog() {
  # catalog 的 default 一律从 current 推导：versions.json.default 与 current 是
  # 同一个事实，不允许本命令单独改写公开默认（review P2）。--default 仅作一致性
  # 校验；与持锁发布并发时同样持锁，避免旧快照覆盖发布方刚写的 catalog。
  local default_arg="" dry_run=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --default) default_arg="$2"; shift 2 ;;
      --dry-run) dry_run=1; shift ;;
      *) die "未知参数: $1" ;;
    esac
  done
  require_tool
  with_lock
  local current_target derived=""
  current_target="$(readlink "$ROOT/current" 2>/dev/null || true)"
  if [[ -n "$current_target" && "$current_target" == datasets/* ]]; then
    derived="${current_target#datasets/}"
  fi
  [[ -n "$derived" ]] || die "无法从 current 推导默认 dataset（current -> ${current_target:-missing}）"
  if [[ -n "$default_arg" && "$default_arg" != "$derived" ]]; then
    die "catalog --default $default_arg 与 current（$derived）不一致；默认切换请走 dataset.sh default --dataset <id>"
  fi
  local args=(catalog --root "$DATASETS" --out "$CATALOG" --default "$derived")
  [[ "$dry_run" == "1" ]] && args+=(--dry-run)
  snapshot_catalog
  if ! "$PYTHON" "$TOOL" "${args[@]}"; then
    restore_catalog || note "WARNING: 无法恢复 $CATALOG，请人工核对"
    die "versions.json 生成失败（catalog 已回滚）"
  fi
}

cmd_rollback() {
  # Rollback is the same atomic dataset switch; the catalog records the older release.
  cmd_link "$@"
}

cmd_unlink() {
  # Remove a dataset entry (symlink only; the release directory stays for rollback).
  # Fail closed when the dataset is the current default: repoint `default` first,
  # otherwise legacy clients reading /current would start failing.
  local dataset="" redirect="" dry_run=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dataset) dataset="$2"; shift 2 ;;
      --redirect-to) redirect="$2"; require_dataset "$redirect"; shift 2 ;;
      --dry-run) dry_run=1; shift ;;
      *) die "未知参数: $1" ;;
    esac
  done
  require_dataset "$dataset"
  local link="$DATASETS/$dataset"
  # 工具必须在删除链接之前就位：否则 rm 之后 catalog 无法重算，线上目录与
  # versions.json 会不一致（review P1）。
  require_tool
  # 持锁后再检查 symlink 与"是否当前默认"：与持锁的 default 切换交错时，
  # 锁前检查会放过"刚被切成默认"的目标，锁后重查才不会 rm 掉正在服务的
  # dataset、留下悬空 current（review P1）。
  with_lock
  [[ -L "$link" ]] || die "dataset 不存在或不是符号链接: $link"
  if [[ "$(readlink "$ROOT/current")" == "datasets/$dataset" ]]; then
    die "dataset $dataset 是当前默认（current 指向它）；先 dataset.sh default --dataset <其他> 再 unlink"
  fi
  local catalog_default
  catalog_default="$(current_default)"
  [[ -n "$catalog_default" ]] || die "无法确定 catalog default（current 缺失）"
  if [[ -n "$redirect" ]]; then
    [[ "$dataset" != "$redirect" ]] || die "不能将 dataset 重定向给自己"
    local target
    target="$(readlink "$DATASETS/$redirect")" || die "目标 dataset 不存在"
    [[ "$target" == ../releases/* ]] || die "目标须为直接发布的 dataset"
    verify_release "$redirect" "${target#../releases/}"
  fi
  if [[ "$dry_run" == "1" ]]; then
    note "would retire $link (currently $(readlink "$link"), replacement: ${redirect:-none})"
    return 0
  fi
  local previous
  previous="$(readlink "$link")"
  snapshot_catalog
  if [[ -n "$redirect" ]]; then
    switch_symlink "$link" "$redirect" 0
  else
    rm "$link"
  fi
  if ! "$PYTHON" "$TOOL" catalog --root "$DATASETS" --out "$CATALOG" --default "$catalog_default"; then
    rollback_online "$link" "$previous"
    die "versions.json 生成失败（dataset 已恢复）"
  fi
  if ! "$PYTHON" "$TOOL" verify --root "$DATASETS" --catalog "$CATALOG"; then
    rollback_online "$link" "$previous"
    die "发布后 verify 失败（dataset 已恢复）"
  fi
  audit "unlink" "$dataset" "$redirect" "$previous"
  note "unlinked dataset=$dataset (was $previous)"
}

cmd_list() {
  echo "root: $ROOT"
  echo "current -> $(readlink "$ROOT/current" 2>/dev/null || echo '(missing)')"
  if [[ -d "$DATASETS" ]]; then
    for link in "$DATASETS"/*; do
      [[ -L "$link" ]] || continue
      echo "$(basename "$link") -> $(readlink "$link")"
    done
  fi
  if [[ -f "$CATALOG" ]]; then
    "$PYTHON" - "$CATALOG" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
print(f"catalog: default={doc.get('default')} datasets={len(doc.get('datasets', []))}")
for item in doc.get("datasets", []):
    print(f"  {item.get('id')}: release={item.get('release')} status={item.get('status')}")
PY
  fi
}

cmd_verify() {
  local full=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --full) full=1; shift ;;
      *) die "未知参数: $1" ;;
    esac
  done
  require_tool
  local args=(verify --root "$DATASETS" --catalog "$CATALOG")
  [[ "$full" == "1" ]] && args+=(--full)
  "$PYTHON" "$TOOL" "${args[@]}"
}

case "${1:-}" in
  link) shift; cmd_link "$@" ;;
  default) shift; cmd_default "$@" ;;
  catalog) shift; cmd_catalog "$@" ;;
  rollback) shift; cmd_rollback "$@" ;;
  unlink) shift; cmd_unlink "$@" ;;
  list) shift; cmd_list "$@" ;;
  verify) shift; cmd_verify "$@" ;;
  -h|--help|help) usage 0 ;;
  *) usage 1 ;;
esac
