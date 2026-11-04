#!/usr/bin/env bash
# Read each origin under its deploy lock; HTTP load balancing is not an identity oracle.
set -Eeuo pipefail

if [ "${1:-}" = read ] || [ "${1:-}" = read-patch ]; then
  action="$1"
  dir="$2"; lock="$3"; name="$4"
  if [ "$action" = read ]; then
    [[ "$name" =~ ^wotbtools-android-v[0-9]+\.[0-9]+\.[0-9]+\.staging\.json$ ]] || exit 2
  else
    [[ "$name" =~ ^wotbtools-android-delta-[0-9]+-[0-9]+-[0-9a-f]{64}\.vcdiff$ ]] || exit 2
  fi
  [ -f "$lock" ] && [ -w "$lock" ] || exit 2
  exec 9>"$lock"
  flock -w 900 9 || exit 2
  [ -d "$dir" ] && [ -r "$dir" ] && [ -x "$dir" ] || exit 2
  path="$dir/$name"
  if [ ! -e "$path" ] && [ ! -L "$path" ]; then exit 44; fi
  [ -f "$path" ] && [ ! -L "$path" ] && [ -s "$path" ] && [ -r "$path" ] || exit 2
  if [ "$action" = read-patch ]; then
    expected_sha="$5"; expected_size="$6"
    [[ "$expected_sha" =~ ^[0-9a-f]{64}$ && "$expected_size" =~ ^[0-9]+$ ]] || exit 2
    [ "$(sha256sum "$path" | awk '{print $1}')" = "$expected_sha" ] && [ "$(stat -c '%s' "$path")" = "$expected_size" ] || exit 2
    exit 0
  fi
  cat -- "$path"
  exit
fi

mode="${1:-}"
if { [ "$mode" != collect ] && [ "$mode" != collect-required ]; } || [ $# -ne 3 ]; then
  echo 'usage: staging-evidence.sh collect <name> <output>' >&2; exit 2
fi
name="$2"; output="$3"
[[ "$name" =~ ^wotbtools-android-v[0-9]+\.[0-9]+\.[0-9]+\.staging\.json$ ]] || exit 2
tmp="$(mktemp -d "${RUNNER_TEMP:?}/staging-origins.XXXXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
probe() {
  local label="$1" host="$2" user="$3" port="$4" key="$5" dir="$6" lock="$7" rc=0
  [ -n "$host" ] && [ -n "$user" ] && [ -n "$port" ] && [ -n "$key" ] || { echo "$label: UNREACHABLE (missing SSH configuration)" >&2; return 1; }
  printf '%s\n' "$key" > "$tmp/key"; chmod 600 "$tmp/key"
  ssh -i "$tmp/key" -p "$port" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o StrictHostKeyChecking=no -o ConnectTimeout=15 "$user@$host" \
    "bash -s -- read '$dir' '$lock' '$name'" < "$0" > "$tmp/$label" || rc=$?
  case "$rc" in
    0) python3 -m json.tool "$tmp/$label" >/dev/null || { echo "$label: PRESENT_INVALID" >&2; return 1; }; echo "$label: PRESENT" >&2 ;;
    44) rm -f "$tmp/$label"; echo "$label: MISSING" >&2 ;;
    *) echo "$label: UNREACHABLE or PRESENT_INVALID (rc=$rc)" >&2; return 1 ;;
  esac
}
probe tx1 "$TX1_SSH_HOST" "$TX1_SSH_USER" "$TX1_SSH_PORT" "$TX1_SSH_KEY" /opt/wotb-tx/android-release /opt/wotb-tx/.deploy.lock
probe tx2 "$TX2_SSH_HOST" "$TX2_SSH_USER" "$TX2_SSH_PORT" "$TX2_SSH_KEY" /opt/wotb-tx2/runtime-content/android-release /opt/wotb-tx2/.deploy.lock
if [ "$mode" = collect-required ] && { [ ! -f "$tmp/tx1" ] || [ ! -f "$tmp/tx2" ]; }; then
  echo 'both origins must contain immutable evidence' >&2; exit 1
fi
if [ -f "$tmp/tx1" ] && [ -f "$tmp/tx2" ]; then
  cmp -s "$tmp/tx1" "$tmp/tx2" || { echo 'CONFLICT: origin staging evidence differs' >&2; exit 1; }
fi
if [ "$mode" = collect-required ]; then
  # Revalidate every referenced immutable patch on both origins, not only the public replica.
  python3 - "$tmp/tx1" > "$tmp/patches" <<'PY'
import json, re, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
patches = data.get('patches', [])
if not isinstance(patches, list) or len(patches) > 1:
    raise SystemExit('invalid patch list')
for patch in patches:
    url, sha, size = patch['url'], patch['sha256'], patch['size']
    name = url.rsplit('/', 1)[-1]
    if not re.fullmatch(r'wotbtools-android-delta-[0-9]+-[0-9]+-[0-9a-f]{64}\.vcdiff', name) or not re.fullmatch(r'[0-9a-f]{64}', sha) or not name.endswith(sha + '.vcdiff') or type(size) is not int or size <= 0:
        raise SystemExit('invalid immutable patch identity')
    print(name, sha, size)
PY
  while read -r patch sha size; do
    for node in tx1 tx2; do
      if [ "$node" = tx1 ]; then host="$TX1_SSH_HOST"; user="$TX1_SSH_USER"; port="$TX1_SSH_PORT"; key="$TX1_SSH_KEY"; dir=/opt/wotb-tx/android-release; lock=/opt/wotb-tx/.deploy.lock
      else host="$TX2_SSH_HOST"; user="$TX2_SSH_USER"; port="$TX2_SSH_PORT"; key="$TX2_SSH_KEY"; dir=/opt/wotb-tx2/runtime-content/android-release; lock=/opt/wotb-tx2/.deploy.lock; fi
      printf '%s\n' "$key" > "$tmp/key"; chmod 600 "$tmp/key"
      ssh -i "$tmp/key" -p "$port" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=15 "$user@$host" \
        "bash -s -- read-patch '$dir' '$lock' '$patch' '$sha' '$size'" < "$0" \
        || { echo "$node: immutable patch unavailable or mismatched" >&2; exit 1; }
    done
  done < "$tmp/patches"
fi
if [ -f "$tmp/tx1" ]; then cp "$tmp/tx1" "$output"; echo 200
elif [ -f "$tmp/tx2" ]; then cp "$tmp/tx2" "$output"; echo 200
else rm -f -- "$output"; echo 404
fi
