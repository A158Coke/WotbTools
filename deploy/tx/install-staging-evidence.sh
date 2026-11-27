#!/usr/bin/env bash
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
[ -f "$source_file" ] && [ ! -L "$source_file" ] && [ -s "$source_file" ] \
  || fail "incoming evidence is missing, empty or not a regular file: $source_file"

name="${source_file##*/}"
dest="$dest_dir/$name"
exec 9>"$lock_file"
flock -w "$wait_secs" 9 \
  || fail "timed out after ${wait_secs}s waiting for $lock_file (holder diagnostics: deploy/tx/with-deploy-lock.sh)"
[ -d "$dest_dir" ] || fail "served destination directory is missing after acquiring the lock: $dest_dir"
[ ! "$source_file" -ef "$dest" ] || fail "incoming scratch aliases the served artifact: $source_file"
tmp="$(mktemp "$dest_dir/.android-evidence.XXXXXXXX")"
trap 'rm -f -- "$tmp"' EXIT
cp -- "$source_file" "$tmp"
chmod 0644 "$tmp"
if [ "$kind" = delta ]; then
  expected="${name%.vcdiff}"; expected="${expected##*-}"
  actual="$(sha256sum "$tmp" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || fail "incoming delta does not match its content-addressed name"
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
if ! ln -T -- "$tmp" "$dest" 2>/dev/null; then
  [ -f "$dest" ] && [ ! -L "$dest" ] && cmp -s "$tmp" "$dest" \
    || fail "immutable $kind conflict: $dest"
fi
rm -f -- "$source_file"
echo "staging artifact installed: $dest sha256=$(sha256sum "$dest" | awk '{print $1}')"
