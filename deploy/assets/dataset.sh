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
# Usage:
#   dataset.sh link --dataset 11.21.0 --release 20261105-3f9a2c1b [--default] [--dry-run]
#   dataset.sh default --dataset 11.21.0 [--dry-run]
#   dataset.sh catalog [--default 11.21.0] [--dry-run]
#   dataset.sh rollback --dataset 11.21.0 --release 20261015-aaaaaaaa [--dry-run]
#   dataset.sh unlink --dataset 11.21.0 [--dry-run]
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
DATASET_ID_RE='^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'

die() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "[dataset] $*"; }

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
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

switch_symlink() {
  local link="$1" target="$2" dry_run="$3"
  if [[ "$dry_run" == "1" ]]; then
    note "would link $link -> $target"
    return
  fi
  if [[ -e "$link" && ! -L "$link" ]]; then
    die "$link 已存在且不是符号链接（拒绝覆盖真实目录；先人工确认再清理）"
  fi
  ln -sfn "$target" "$link.new"
  mv -T "$link.new" "$link"
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
  with_lock
  verify_release "$dataset" "$release"

  local previous
  previous="$(readlink "$DATASETS/$dataset" 2>/dev/null || true)"
  switch_symlink "$DATASETS/$dataset" "../releases/$release" "$dry_run"
  if [[ "$make_default" == "1" ]]; then
    switch_symlink "$ROOT/current" "datasets/$dataset" "$dry_run"
  fi
  if [[ "$dry_run" == "0" ]]; then
    audit "link" "$dataset" "$release" "$previous"
    require_tool
    local default_args=()
    [[ "$make_default" == "1" ]] && default_args=(--default "$dataset")
    "$PYTHON" "$TOOL" catalog --root "$DATASETS" --out "$CATALOG" "${default_args[@]}" \
      || die "versions.json 生成失败（dataset 已切换；请修复后重跑 catalog）"
    "$PYTHON" "$TOOL" verify --root "$DATASETS" --catalog "$CATALOG" \
      || die "发布后 verify 失败（dataset 已切换；请回滚）"
  fi
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
  [[ -e "$DATASETS/$dataset" ]] || die "dataset 不存在: $DATASETS/$dataset"
  with_lock
  local previous
  previous="$(readlink "$ROOT/current" 2>/dev/null || true)"
  switch_symlink "$ROOT/current" "datasets/$dataset" "$dry_run"
  if [[ "$dry_run" == "0" ]]; then
    audit "default" "$dataset" "$(readlink "$DATASETS/$dataset")" "$previous"
    require_tool
    "$PYTHON" "$TOOL" catalog --root "$DATASETS" --out "$CATALOG" --default "$dataset" \
      || die "versions.json 生成失败（current 已切换；请修复后重跑 catalog）"
  fi
  note "default dataset=$dataset"
}

cmd_catalog() {
  local default="" dry_run=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --default) default="$2"; shift 2 ;;
      --dry-run) dry_run=1; shift ;;
      *) die "未知参数: $1" ;;
    esac
  done
  require_tool
  local args=(catalog --root "$DATASETS" --out "$CATALOG")
  [[ -n "$default" ]] && args+=(--default "$default")
  [[ "$dry_run" == "1" ]] && args+=(--dry-run)
  "$PYTHON" "$TOOL" "${args[@]}"
}

cmd_rollback() {
  # Rollback is the same atomic dataset switch; the catalog records the older release.
  cmd_link "$@"
}

cmd_unlink() {
  # Remove a dataset entry (symlink only; the release directory stays for rollback).
  # Fail closed when the dataset is the current default: repoint `default` first,
  # otherwise legacy clients reading /current would start failing.
  local dataset="" dry_run=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dataset) dataset="$2"; shift 2 ;;
      --dry-run) dry_run=1; shift ;;
      *) die "未知参数: $1" ;;
    esac
  done
  require_dataset "$dataset"
  local link="$DATASETS/$dataset"
  [[ -L "$link" ]] || die "dataset 不存在或不是符号链接: $link"
  if [[ "$(readlink "$ROOT/current")" == "datasets/$dataset" ]]; then
    die "dataset $dataset 是当前默认（current 指向它）；先 dataset.sh default --dataset <其他> 再 unlink"
  fi
  with_lock
  if [[ "$dry_run" == "1" ]]; then
    note "would unlink $link (-> $(readlink "$link"))"
    return
  fi
  local previous
  previous="$(readlink "$link")"
  rm "$link"
  audit "unlink" "$dataset" "" "$previous"
  require_tool
  "$PYTHON" "$TOOL" catalog --root "$DATASETS" --out "$CATALOG" \
    || die "versions.json 生成失败（dataset 已删除；请修复后重跑 catalog）"
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