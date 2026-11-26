#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${WOTB_ASSET_ROOT:-/srv/wotb-assets}"
RELEASES="$ROOT/releases"
DATASETS="$ROOT/datasets"
CATALOG="$ROOT/versions.json"
AUDIT="$ROOT/release-log.jsonl"
TOOL="${ASSET_RELEASE_TOOL:-$ROOT/bin/asset_release.py}"
PYTHON="${PYTHON:-python3}"
DATASET_ID_RE='^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'

CATALOG_SNAPSHOT=""

die() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "[dataset] $*"; }

cleanup_snapshot() {
  [[ -n "$CATALOG_SNAPSHOT" && -f "$CATALOG_SNAPSHOT" ]] && rm -f "$CATALOG_SNAPSHOT"
  return 0
}
trap cleanup_snapshot EXIT

current_default() {
  local t
  t="$(readlink "$ROOT/current" 2>/dev/null || true)"
  if [[ -n "$t" && "$t" == datasets/* ]]; then
    printf "%s" "${t#datasets/}"
  fi
}

usage() {
  cat <<'USAGE'
Usage:
  dataset.sh link --dataset 11.21.0 --release 20261105-3f9a2c1b [--default] [--dry-run]
  dataset.sh default --dataset 11.21.0 [--dry-run]
  dataset.sh catalog [--default <id>] [--dry-run]   # default 从 current 推导，仅作校验
  dataset.sh rollback --dataset 11.21.0 --release 20261015-aaaaaaaa [--dry-run]
  dataset.sh unlink --dataset 11.21.0 [--redirect-to <active-id>] [--dry-run]
  dataset.sh list
  dataset.sh verify [--full]
USAGE
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
  [[ -d "$(dirname "$link")" ]] || mkdir -p "$(dirname "$link")" || return 1
  ln -sfn "$target" "$link.new" && mv -T "$link.new" "$link"
}

restore_symlink() {
  local link="$1" previous="$2"
  if [[ -z "$previous" ]]; then
    rm -f "$link"
    return 0
  fi
  ln -sfn "$previous" "$link.new" && mv -T "$link.new" "$link"
}

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
  require_tool
  with_lock
  verify_release "$dataset" "$release"
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
  cmd_link "$@"
}

cmd_unlink() {
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
  require_tool
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
