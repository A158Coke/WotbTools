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

# adopt-existing.sh loads the staged release manifest for the pinned digest and
# proves the *live inode* against it. Drive a fixture copy of the lifecycle whose
# manifest pins the disposable "live executable", so the reviewed-binary proof can
# be exercised without the real release artifact.
fixture_runtime="$work/periphery"
cp -a "$ROOT/deploy/periphery" "$fixture_runtime"
live_exe="$work/live-periphery"
printf '#!/usr/bin/env bash\necho fixture-periphery\n' > "$live_exe"
chmod 0755 "$live_exe"
live_sha="$(sha256sum "$live_exe" | awk '{print $1}')"
sed -i "s/^PERIPHERY_SHA256=.*/PERIPHERY_SHA256=$live_sha/" "$fixture_runtime/periphery.release"
# A different binary: the replaced-inode case where the pathname is pinned but the
# running process still executes the previous file.
stale_exe="$work/stale-periphery"
printf '#!/usr/bin/env bash\necho old-fixture-periphery\n' > "$stale_exe"
chmod 0755 "$stale_exe"

stub="$work/bin"
host="$work/host"
process_environ="$host/proc/4242/environ"
process_cmdline="$host/proc/4242/cmdline"
process_exe="$host/proc/4242/exe"
mkdir -p "$stub" "$host/etc/keys" "$host/unit" "$host/run" "$host/proc/4242" "$host/lock" "$host/stage"
printf '%s\n' 'fixture-periphery-private-key' > "$host/etc/keys/periphery.key"
printf '%s\n' 'fixture-core-public-key' > "$host/etc/keys/core.pub"
: > "$process_environ"
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

write_process_env() {
  : > "$process_environ"
  local item
  for item in "$@"; do
    [[ -n "$item" ]] || continue
    printf '%s\0' "$item" >> "$process_environ"
  done
}

# NUL-separated argv exactly as the kernel exposes it through /proc/<pid>/cmdline.
# The path is recreated first so a fifo fixture can never be reused (opening a
# fifo for writing blocks until a reader appears).
write_cmdline() {
  rm -f "$process_cmdline"
  : > "$process_cmdline"
  local arg
  for arg in "$@"; do
    printf '%s\0' "$arg" >> "$process_cmdline"
  done
}

# The reviewed steady-state unit starts the agent with exactly
# `/usr/local/bin/periphery --config-path /etc/komodo/periphery.config.toml`.
# The fixture keeps the reviewed binary path and only redirects the config root
# into the disposable tree through the same helper variables production uses.
write_cmdline_variant() {
  case "$1" in
    reviewed) write_cmdline /usr/local/bin/periphery --config-path "$host/etc/periphery.config.toml" ;;
    other-config) write_cmdline /usr/local/bin/periphery --config-path "$host/etc/other.config.toml" ;;
    duplicate-selector) write_cmdline /usr/local/bin/periphery \
      --config-path "$host/etc/periphery.config.toml" \
      --config-path "$host/etc/other.config.toml" ;;
    short-selector) write_cmdline /usr/local/bin/periphery -c "$host/etc/other.config.toml" ;;
    inline-selector) write_cmdline /usr/local/bin/periphery --config-path="$host/etc/other.config.toml" ;;
    extra-argument) write_cmdline /usr/local/bin/periphery \
      --config-path "$host/etc/periphery.config.toml" --debug ;;
    wrong-binary) write_cmdline /opt/unreviewed/periphery \
      --config-path "$host/etc/periphery.config.toml" ;;
    missing) rm -f "$process_cmdline" ;;
    fifo) rm -f "$process_cmdline"; mkfifo "$process_cmdline" ;;
    *) echo "unknown cmdline fixture: $1" >&2; exit 2 ;;
  esac
}

# /proc/<pid>/exe is the magic symlink to the inode the process actually runs. The
# lifecycle must hash that inode, not the on-disk pathname.
write_exe_variant() {
  # -r so the deliberate "directory" variant can never poison a later case.
  rm -rf -- "$process_exe"
  case "$1" in
    reviewed) ln -s "$live_exe" "$process_exe" ;;
    stale) ln -s "$stale_exe" "$process_exe" ;;
    missing) ;;
    directory) mkdir -p "$process_exe" ;;
    *) echo "unknown executable fixture: $1" >&2; exit 2 ;;
  esac
}

invoke_adopt() {
  local peer="$1" log="$2" rc
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
    bash "$fixture_runtime/adopt-existing.sh" ali-sh-asset-01 >"$log" 2>&1
  rc=$?
  set -e
  return "$rc"
}

run_adopt() {
  local config="$1" peer="$2" log="$3" process_override="${4:-}" cmdline_variant="${5:-reviewed}"
  local exe_variant="${6:-reviewed}"
  cp "$config" "$host/etc/periphery.config.toml"
  write_process_env "$process_override"
  write_cmdline_variant "$cmdline_variant"
  write_exe_variant "$exe_variant"
  invoke_adopt "$peer" "$log"
}

# rejects <label> <config> <peer> [process_override] [cmdline_variant] [reason] [exe_variant]
#
# Every rejection must also fail for the intended reason, so a fixture cannot pass
# because an earlier unrelated check tripped.
rejects() {
  local label="$1" config="$2" peer="$3" process_override="${4:-}" cmdline_variant="${5:-reviewed}"
  local reason="${6:-}" exe_variant="${7:-reviewed}" log="$work/$label.log"
  if run_adopt "$config" "$peer" "$log" "$process_override" "$cmdline_variant" "$exe_variant"; then
    echo "unsafe existing-host adoption was accepted: $label" >&2
    cat "$log" >&2
    exit 1
  fi
  [[ ! -e "$marker" ]] || {
    echo "unsafe existing-host adoption committed the durable marker: $label" >&2
    exit 1
  }
  if [[ -n "$reason" ]]; then
    grep -Fq -- "$reason" "$log" || {
      echo "adoption rejected '$label' for an unexpected reason (wanted: $reason)" >&2
      cat "$log" >&2
      exit 1
    }
  fi
}

config_delta_reason='Installed Periphery identity/Core config does not match the reviewed target.'
rejects wrong-core "$wrong_core" "$peer_valid" '' reviewed "$config_delta_reason"
rejects wrong-connect-as "$wrong_as" "$peer_valid" '' reviewed "$config_delta_reason"
rejects insecure-core-tls "$insecure" "$peer_valid" '' reviewed "$config_delta_reason"
rejects wrong-root-directory "$wrong_root" "$peer_valid" '' reviewed "$config_delta_reason"
rejects wrong-private-key "$wrong_private_key" "$peer_valid" '' reviewed "$config_delta_reason"
rejects wrong-core-public-keys "$wrong_core_pub" "$peer_valid" '' reviewed "$config_delta_reason"
rejects extra-semantic-delta "$extra_semantic" "$peer_valid" '' reviewed "$config_delta_reason"
rejects local-443xx "$valid" "$peer_local_443xx" '' reviewed 'no established connection to reviewed Core peer'
rejects remote-4430 "$valid" "$peer_4430" '' reviewed 'no established connection to reviewed Core peer'

# The running process's effective config may differ from TOML because Komodo
# v2.3.3 gives environment variables precedence, and it parses UPPERCASE and
# lowercase names alike. Adoption therefore rejects every Periphery-prefixed entry
# in any case, including *_FILE forms used for credentials and identity paths,
# instead of attempting an incomplete allowlist.
env_reason='Periphery environment override'
rejects env-connect-as "$valid" "$peer_valid" 'PERIPHERY_CONNECT_AS=wrong-server' reviewed "$env_reason"
rejects env-root-directory "$valid" "$peer_valid" 'PERIPHERY_ROOT_DIRECTORY=/opt/other-komodo' reviewed "$env_reason"
rejects env-insecure-tls "$valid" "$peer_valid" 'PERIPHERY_CORE_TLS_INSECURE_SKIP_VERIFY=true' reviewed "$env_reason"
rejects env-core-addresses "$valid" "$peer_valid" 'PERIPHERY_CORE_ADDRESSES=https://wrong-core.invalid:4430' reviewed "$env_reason"
rejects env-private-key-file "$valid" "$peer_valid" 'PERIPHERY_PRIVATE_KEY_FILE=/tmp/unreviewed-periphery.key' reviewed "$env_reason"
rejects env-onboarding-key-file "$valid" "$peer_valid" 'PERIPHERY_ONBOARDING_KEY_FILE=/tmp/onboarding-key' reviewed "$env_reason"
rejects env-onboarding-key "$valid" "$peer_valid" 'PERIPHERY_ONBOARDING_KEY=secret-fixture' reviewed "$env_reason"
rejects env-passkeys-file "$valid" "$peer_valid" 'PERIPHERY_PASSKEYS_FILE=/tmp/passkeys' reviewed "$env_reason"
# Komodo v2.3.3 also accepts lowercase environment names, and they override the
# TOML just the same. A case-sensitive prefix match would certify the reviewed
# config while an unreviewed identity/Core route is actually in force.
rejects env-lowercase-connect-as "$valid" "$peer_valid" 'periphery_connect_as=wrong-server' reviewed "$env_reason"
rejects env-lowercase-private-key "$valid" "$peer_valid" 'periphery_private_key=file:/tmp/unreviewed-periphery.key' reviewed "$env_reason"
rejects env-lowercase-core-addresses "$valid" "$peer_valid" 'periphery_core_addresses=https://wrong-core.invalid:4430' reviewed "$env_reason"
rejects env-lowercase-onboarding-key "$valid" "$peer_valid" 'periphery_onboarding_key=secret-fixture' reviewed "$env_reason"
rejects env-mixed-case-connect-as "$valid" "$peer_valid" 'PeRiPhErY_CONNECT_AS=wrong-server' reviewed "$env_reason"

# A matching PERIPHERY_* entry followed by ~1 MB of environment data: a
# `tr ... | grep -q` pipeline is allowed to fail with SIGPIPE on the producer and,
# under `set -o pipefail`, report "no match". Repeating the case makes any
# size/scheduling-dependent false negative visible instead of flaky.
big_filler="$(head -c 262144 /dev/zero | tr '\0' 'A')"
for attempt in $(seq 1 20); do
  cp "$valid" "$host/etc/periphery.config.toml"
  : > "$process_environ"
  printf '%s\0' 'PERIPHERY_CONNECT_AS=wrong-server' >> "$process_environ"
  for name in FILLER_ONE FILLER_TWO FILLER_THREE FILLER_FOUR; do
    printf '%s=%s\0' "$name" "$big_filler" >> "$process_environ"
  done
  write_cmdline_variant reviewed
  write_exe_variant reviewed
  if invoke_adopt "$peer_valid" "$work/large-env-$attempt.log"; then
    echo "a large live environment hid a PERIPHERY_* override (attempt $attempt)" >&2
    cat "$work/large-env-$attempt.log" >&2
    exit 1
  fi
  [[ ! -e "$marker" ]] || {
    echo "a large live environment let adoption commit the durable marker (attempt $attempt)" >&2
    exit 1
  }
  grep -Fq -- "$env_reason" "$work/large-env-$attempt.log" || {
    echo "large-environment adoption was rejected for an unexpected reason (attempt $attempt)" >&2
    cat "$work/large-env-$attempt.log" >&2
    exit 1
  }
done

# A reviewed TOML on disk is not proof of the effective config. Komodo v2.3.3 gives
# CLI config selection precedence over TOML/environment, so the live argv must be
# exactly the reviewed steady-state invocation.
argv_reason='argv is not exactly'
rejects other-config "$valid" "$peer_valid" '' other-config "$argv_reason"
rejects duplicate-config-selector "$valid" "$peer_valid" '' duplicate-selector "$argv_reason"
rejects short-config-selector "$valid" "$peer_valid" '' short-selector "$argv_reason"
rejects inline-config-selector "$valid" "$peer_valid" '' inline-selector "$argv_reason"
rejects extra-argument "$valid" "$peer_valid" '' extra-argument "$argv_reason"
rejects wrong-executable "$valid" "$peer_valid" '' wrong-binary "$argv_reason"
rejects missing-cmdline "$valid" "$peer_valid" '' missing 'Cannot inspect the argv'
rejects uninspectable-cmdline "$valid" "$peer_valid" '' fifo 'Cannot inspect the argv'

# A correct argv pathname is not proof that the process executes the pinned inode:
# an atomically replaced binary leaves the old process on the deleted file, so the
# live executable behind /proc/<pid>/exe must hash to the staged release digest.
rejects stale-live-executable "$valid" "$peer_valid" '' reviewed 'still running a replaced or stale executable' stale
rejects missing-live-executable "$valid" "$peer_valid" '' reviewed 'Cannot inspect the executable behind' missing
rejects uninspectable-live-executable "$valid" "$peer_valid" '' reviewed 'Cannot inspect the executable behind' directory

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
