#!/usr/bin/env bash
# Helper fixture for test-periphery.sh. It drives the real adopt-existing.sh
# against disposable host state and stubs only systemd/ss. This is deliberately
# not a standalone CI entrypoint; test-periphery.sh remains the owner's single
# fixture entrypoint.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
cleanup() { sudo rm -rf "$work"; }
trap cleanup EXIT

stub="$work/bin"
host="$work/host"
mkdir -p "$stub" "$host/etc/keys" "$host/unit" "$host/run" "$host/proc/4242" "$host/lock" "$host/stage"
printf '%s\n' 'fixture-periphery-private-key' > "$host/etc/keys/periphery.key"
printf '%s\n' 'fixture-core-public-key' > "$host/etc/keys/core.pub"
: > "$host/proc/4242/environ"
touch "$host/lock/.deploy.lock"

cat > "$stub/systemctl" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$*" in
  'is-active --quiet periphery') exit 0 ;;
  'show periphery -p MainPID --value') printf '%s\n' 4242 ;;
  *) echo "unexpected systemctl fixture invocation: $*" >&2; exit 2 ;;
esac
EOF

cat > "$stub/ss" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$*" == *':8120'* ]]; then
  exit 0
fi
cat "${SS_FIXTURE:?}"
EOF
chmod +x "$stub/systemctl" "$stub/ss"

valid="$work/valid.toml"
cat > "$valid" <<'EOF'
root_directory = "/etc/komodo"
core_address = "https://komodo.wotbtools.com"
connect_as = "ali-sh-asset-01"
EOF

wrong_core="$work/wrong-core.toml"
sed 's#https://komodo.wotbtools.com#https://wrong-core.invalid:4430#' "$valid" > "$wrong_core"
wrong_as="$work/wrong-connect-as.toml"
sed 's/connect_as = "ali-sh-asset-01"/connect_as = "wrong-server"/' "$valid" > "$wrong_as"
insecure="$work/insecure.toml"
cp "$valid" "$insecure"
printf '%s\n' 'core_tls_insecure_skip_verify = true' >> "$insecure"
wrong_root="$work/wrong-root.toml"
sed 's#root_directory = "/etc/komodo"#root_directory = "/opt/other-komodo"#' "$valid" > "$wrong_root"
wrong_private_key="$work/wrong-private-key.toml"
cp "$valid" "$wrong_private_key"
printf '%s\n' 'private_key = "file:/tmp/unreviewed-periphery.key"' >> "$wrong_private_key"
wrong_core_pub="$work/wrong-core-pub.toml"
cp "$valid" "$wrong_core_pub"
printf '%s\n' 'core_public_keys = ["file:/tmp/unreviewed-core.pub"]' >> "$wrong_core_pub"
extra_semantic="$work/extra-semantic.toml"
cp "$valid" "$extra_semantic"
printf '%s\n' 'disable_terminals = true' >> "$extra_semantic"

peer_valid="$work/peer-valid"
peer_local_443xx="$work/peer-local-443xx"
peer_4430="$work/peer-4430"
printf '%s\n' 'ESTAB 0 0 172.24.21.88:40000 1.2.3.4:443 users:(("periphery",pid=4242,fd=9))' > "$peer_valid"
printf '%s\n' 'ESTAB 0 0 172.24.21.88:44321 1.2.3.4:80 users:(("periphery",pid=4242,fd=9))' > "$peer_local_443xx"
printf '%s\n' 'ESTAB 0 0 172.24.21.88:40000 1.2.3.4:4430 users:(("periphery",pid=4242,fd=9))' > "$peer_4430"

marker="$host/etc/keys/onboarding-complete"

run_adopt() {
  local config="$1" peer="$2" log="$3"
  cp "$config" "$host/etc/periphery.config.toml"
  sudo rm -f "$marker" "$marker.incoming"
  set +e
  sudo env \
    PATH="$stub:$PATH" \
    SS_FIXTURE="$peer" \
    PERIPHERY_ETC_DIR="$host/etc" \
    PERIPHERY_UNIT_DIR="$host/unit" \
    PERIPHERY_RUN_DIR="$host/run" \
    PERIPHERY_PROC_ROOT="$host/proc" \
    PERIPHERY_SYSTEMCTL="$stub/systemctl" \
    PERIPHERY_LOCK_ROOT="$host/lock" \
    PERIPHERY_STAGING_ROOT="$host/stage" \
    bash "$ROOT/deploy/periphery/adopt-existing.sh" ali-sh-asset-01 >"$log" 2>&1
  local rc=$?
  set -e
  return "$rc"
}

rejects() {
  local label="$1" config="$2" peer="$3" log="$work/$1.log"
  if run_adopt "$config" "$peer" "$log"; then
    echo "unsafe existing-host adoption was accepted: $label" >&2
    cat "$log" >&2
    exit 1
  fi
  [[ ! -e "$marker" ]] || {
    echo "unsafe existing-host adoption committed the durable marker: $label" >&2
    exit 1
  }
}

rejects wrong-core "$wrong_core" "$peer_valid"
rejects wrong-connect-as "$wrong_as" "$peer_valid"
rejects insecure-core-tls "$insecure" "$peer_valid"
rejects wrong-root-directory "$wrong_root" "$peer_valid"
rejects wrong-private-key "$wrong_private_key" "$peer_valid"
rejects wrong-core-public-keys "$wrong_core_pub" "$peer_valid"
rejects extra-semantic-delta "$extra_semantic" "$peer_valid"
rejects local-443xx "$valid" "$peer_local_443xx"
rejects remote-4430 "$valid" "$peer_4430"

if ! run_adopt "$valid" "$peer_valid" "$work/valid.log"; then
  echo 'valid already-onboarded Alibaba host was rejected' >&2
  cat "$work/valid.log" >&2
  exit 1
fi
[[ "$(sudo cat "$marker")" == 'komodo-periphery-onboarding-v1' ]] || {
  echo 'valid adoption did not commit the reviewed marker content' >&2
  exit 1
}
[[ "$(sudo stat -c '%a:%u:%g' "$marker")" == '600:0:0' ]] || {
  echo 'valid adoption marker is not root:root mode 0600' >&2
  exit 1
}

echo 'Periphery existing-host adoption fixture: PASS'
