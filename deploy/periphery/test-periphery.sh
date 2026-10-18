#!/usr/bin/env bash
# Fixtures for the Komodo Periphery owner (K3.1): the audited staging-root guard
# and the release / config / unit / onboarding-lifecycle contract.
#
# Executable rather than string-only: the contracts are checked as data, the
# onboarding decision is driven through the real `install.sh` with stubbed
# systemd/ss, and the ":8120 has no listener" guard is proven against a
# deliberately bound port. No production secret, no SSH, no Docker, no network.
#
# This is the owner's single fixture entrypoint: the checks are production-safety
# invariants (host path safety, bootstrap-credential lifecycle, fail-closed
# reconciliation, no inbound exposure) that no native validator can carry.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

work="$(mktemp -d)"
probe_pid=
cleanup() {
  [[ -z "$probe_pid" ]] || kill "$probe_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

# Independent statements of the K3.1 pin (never read from the manifest).
EXPECTED_VERSION=2.3.3
EXPECTED_SHA256=40b78f377626799afad8331246a501f077d4ebcfb6d9096894cf55b64f6dcf13

die() { echo "$*" >&2; exit 1; }
pass() { printf 'PASS %s\n' "$1"; }
effective() { grep -vE '^[[:space:]]*#' "$1" | grep -vE '^[[:space:]]*$'; }

sha=0123456789abcdef0123456789abcdef01234567
other_sha=fedcba9876543210fedcba9876543210fedcba98

# run <action> <sha> <root> -> helper status (output discarded)
run() {
  bash "$ROOT/staging-root.sh" "$1" "$2" "$3" >/dev/null 2>&1
}

# run_env <action> <sha> <root> -> the environment-only invocation the workflow
# uses with `script_path` (no argv).
run_env() {
  env PERIPHERY_STAGING_ACTION="$1" SOURCE_SHA="$2" PERIPHERY_STAGING_ROOT="$3" \
    bash "$ROOT/staging-root.sh" >/dev/null 2>&1
}

accepts() {
  run "$1" "$2" "$3" || { echo "safe staging case was rejected: $1 $2 $3" >&2; exit 1; }
}

rejects() {
  if run "$1" "$2" "$3"; then
    echo "unsafe staging case was accepted: $1 $2 $3" >&2
    exit 1
  fi
}

is_real_dir_mode_700() {
  [[ -d "$1" && ! -L "$1" && "$(stat -c '%a' "$1")" == 700 ]]
}

# --- argument validation -----------------------------------------------------
if bash "$ROOT/staging-root.sh" destroy "$sha" "$work/x" >/dev/null 2>&1; then
  echo 'an unknown staging-root action was accepted' >&2
  exit 1
fi
if bash "$ROOT/staging-root.sh" prepare "" "$work/x" >/dev/null 2>&1; then
  echo 'a missing staging SHA was accepted' >&2
  exit 1
fi
if bash "$ROOT/staging-root.sh" prepare not-a-sha "$work/x" >/dev/null 2>&1; then
  echo 'a malformed staging SHA was accepted' >&2
  exit 1
fi
for bad_root in relative/path /tmp/../etc; do
  if bash "$ROOT/staging-root.sh" prepare "$sha" "$bad_root" >/dev/null 2>&1; then
    echo "an unsafe staging root was accepted: $bad_root" >&2
    exit 1
  fi
done

# --- fresh root --------------------------------------------------------------
fresh="$work/fresh"
accepts prepare "$sha" "$fresh"
is_real_dir_mode_700 "$fresh" || { echo 'prepare did not create a safe root' >&2; exit 1; }
is_real_dir_mode_700 "$fresh/incoming" || { echo 'prepare did not create a safe incoming dir' >&2; exit 1; }
is_real_dir_mode_700 "$fresh/incoming/$sha" || { echo 'prepare did not create a safe staging dir' >&2; exit 1; }
accepts verify "$sha" "$fresh"
run_env prepare "$sha" "$fresh" || { echo 'environment-driven prepare failed' >&2; exit 1; }

# --- existing safe root ------------------------------------------------------
accepts prepare "$sha" "$fresh"
printf '%s\n' 'staged' > "$fresh/incoming/$sha/periphery-x86_64"
accepts cleanup "$sha" "$fresh"
[[ ! -e "$fresh/incoming/$sha" ]] || { echo 'cleanup did not remove the staging directory' >&2; exit 1; }
is_real_dir_mode_700 "$fresh" || { echo 'cleanup damaged the staging root' >&2; exit 1; }
is_real_dir_mode_700 "$fresh/incoming" || { echo 'cleanup damaged the incoming directory' >&2; exit 1; }
accepts cleanup "$other_sha" "$fresh"
run_env cleanup "$sha" "$fresh" || { echo 'environment-driven cleanup failed' >&2; exit 1; }
run_env cleanup "$other_sha" "$fresh" || { echo 'environment-driven no-op cleanup failed' >&2; exit 1; }

# --- unsafe component types --------------------------------------------------
# Built once, then every action must refuse each of them.
symlink_root="$work/symlink-root"
mkdir -p "$work/real-root/incoming"
ln -s "$work/real-root" "$symlink_root"

symlink_incoming="$work/symlink-incoming"
mkdir -p "$symlink_incoming" "$work/real-incoming/$sha"
ln -s "$work/real-incoming" "$symlink_incoming/incoming"

dangling_root="$work/dangling-root"
ln -s "$work/absent-root" "$dangling_root"

dangling_incoming="$work/dangling-incoming"
mkdir -p "$dangling_incoming"
ln -s "$work/absent-incoming" "$dangling_incoming/incoming"

file_root="$work/file-root"
: > "$file_root"

file_incoming="$work/file-incoming"
mkdir -p "$file_incoming"
: > "$file_incoming/incoming"

dangling_staging="$work/dangling-staging"
mkdir -p "$dangling_staging/incoming"
ln -s "$work/absent-staging" "$dangling_staging/incoming/$sha"

for action in prepare verify cleanup; do
  for unsafe_root in \
    "$symlink_root" "$symlink_incoming" "$dangling_root" "$dangling_incoming" \
    "$file_root" "$file_incoming" "$dangling_staging"; do
    rejects "$action" "$sha" "$unsafe_root"
  done
  [[ -d "$work/real-root" ]] || { echo 'a symlinked root was followed' >&2; exit 1; }
  [[ -d "$work/real-incoming/$sha" ]] || { echo 'a symlinked incoming dir was followed' >&2; exit 1; }
done

# A symlinked staging directory must never be followed, and cleanup must leave
# whatever it points at untouched.
victim="$work/victim"
symlink_staging="$work/symlink-staging"
mkdir -p "$victim" "$symlink_staging/incoming"
printf '%s\n' 'must survive' > "$victim/precious"
ln -s "$victim" "$symlink_staging/incoming/$sha"
rejects prepare "$sha" "$symlink_staging"
rejects verify "$sha" "$symlink_staging"
rejects cleanup "$sha" "$symlink_staging"
[[ -f "$victim/precious" ]] || { echo 'cleanup followed a symlinked staging directory' >&2; exit 1; }

# A regular file where the staging directory belongs is refused, not replaced.
file_staging="$work/file-staging"
mkdir -p "$file_staging/incoming"
: > "$file_staging/incoming/$sha"
rejects prepare "$sha" "$file_staging"
rejects verify "$sha" "$file_staging"
rejects cleanup "$sha" "$file_staging"
[[ -f "$file_staging/incoming/$sha" ]] || { echo 'a staged regular file was deleted' >&2; exit 1; }

echo 'Komodo Periphery staging-root guard fixtures: PASS'
# ---------------------------------------------------------------------------
# A. release manifest / version / SHA contract
# ---------------------------------------------------------------------------
# shellcheck disable=SC1090
source "$ROOT/periphery.release"
[[ "$PERIPHERY_VERSION" == "$EXPECTED_VERSION" ]] || die "manifest version drift: $PERIPHERY_VERSION"
[[ "$PERIPHERY_SHA256" == "$EXPECTED_SHA256" ]] || die "manifest SHA drift: $PERIPHERY_SHA256"
[[ "$PERIPHERY_ASSET" == 'periphery-x86_64' ]] || die "unexpected asset: $PERIPHERY_ASSET"
[[ "$PERIPHERY_RELEASE_TAG" == "v$PERIPHERY_VERSION" ]] || die "release tag is not v\$version"
[[ "$PERIPHERY_URL" == "https://github.com/moghtech/komodo/releases/download/$PERIPHERY_RELEASE_TAG/$PERIPHERY_ASSET" ]] \
  || die "release URL is not derived from the pinned tag/asset: $PERIPHERY_URL"

# The same contract must be enforced at runtime, so a tampered manifest fails.
tampered="$work/tampered.release"
sed 's/^PERIPHERY_SHA256=.*/PERIPHERY_SHA256=deadbeef/' "$ROOT/periphery.release" > "$tampered"
if bash -c 'source "$1/lib.sh"; load_release_manifest "$2"' _ "$ROOT" "$tampered" >/dev/null 2>&1; then
  die 'a manifest with an invalid SHA256 was accepted'
fi
sed 's|^PERIPHERY_URL=.*|PERIPHERY_URL=https://example.invalid/periphery|' "$ROOT/periphery.release" > "$tampered"
if bash -c 'source "$1/lib.sh"; load_release_manifest "$2"' _ "$ROOT" "$tampered" >/dev/null 2>&1; then
  die 'a manifest whose URL contradicts the pinned tag/asset was accepted'
fi
pass 'release-manifest version+tag+asset+sha256'

# ---------------------------------------------------------------------------
# B. per-target persistent config contract: outbound only, exact Core, no secret
# ---------------------------------------------------------------------------
targets=(yecao tx1 tx2)
for target in "${targets[@]}"; do
  config="$ROOT/targets/$target/periphery.config.toml"
  [[ -f "$config" ]] || die "missing the $target config: $config"
  for expected in \
    '^root_directory = "/etc/komodo"$' \
    '^core_addresses = \["http://10\.20\.0\.2:9120"\]$' \
    "^connect_as = \"$target\"\$" \
    '^server_enabled = false$' \
    '^private_key = "file:/etc/komodo/keys/periphery\.key"$' \
    '^core_public_keys = \["file:/etc/komodo/keys/core\.pub"\]$' \
    '^disable_terminals = false$' \
    '^disable_container_terminals = false$'; do
    effective "$config" | grep -Eq "$expected" || die "the $target config is missing: $expected"
  done
  # Exactly one address, and it is the private WireGuard Core.
  [[ "$(effective "$config" | grep -cE 'https?://')" == 1 ]] \
    || die "the $target config must name exactly one address"
  # No inbound server, no public/host address, no wildcard bind, no credentials.
  for forbidden in '^bind_ip' '^port[[:space:]]*=' '^allowed_ips[[:space:]]*=[[:space:]]*\[.+\]' \
    '45\.136\.14\.101' '118\.89\.176\.91' '10\.20\.0\.3' 'komodo\.wotbtools\.com' '0\.0\.0\.0' \
    'onboarding_key' 'passkeys' '\[secrets\]' 'git_provider' 'image_registry' \
    '45\.136\.' '118\.25\.' '118\.89\.'; do
    if effective "$config" | grep -Eq "$forbidden"; then
      die "the $target config must not contain: $forbidden"
    fi
  done
done
# Every target's effective settings are identical once connect_as is normalized,
# so no target can silently drift from the reviewed shared contract.
baseline="$work/config-baseline.toml"
effective "$ROOT/targets/yecao/periphery.config.toml" | sed 's/^connect_as = .*/connect_as = X/' > "$baseline"
for target in "${targets[@]}"; do
  diff "$baseline" \
    <(effective "$ROOT/targets/$target/periphery.config.toml" | sed 's/^connect_as = .*/connect_as = X/') >/dev/null \
    || die "the $target effective config differs from the shared contract beyond connect_as"
done
pass "per-target-config outbound-only exact-core-address no-secrets (${targets[*]})"

# ---------------------------------------------------------------------------
# C. systemd unit contract
# ---------------------------------------------------------------------------
unit="$ROOT/periphery.service"
for expected in \
  '^Type=simple$' \
  '^Wants=network-online\.target$' \
  '^After=network-online\.target docker\.service$' \
  '^Requires=docker\.service$' \
  '^EnvironmentFile=-/run/komodo/periphery-bootstrap\.env$' \
  '^ExecStart=/usr/local/bin/periphery --config-path /etc/komodo/periphery\.config\.toml$' \
  '^Restart=on-failure$' \
  '^WantedBy=multi-user\.target$'; do
  effective "$unit" | grep -Eq "$expected" || die "systemd unit is missing: $expected"
done
# Root context (no User=), and the unit itself carries no credential.
if effective "$unit" | grep -Eq '^User='; then
  die 'the K3.1 unit must run in the root systemd context'
fi
if grep -q 'PERIPHERY_ONBOARDING_KEY' "$unit"; then
  die 'the systemd unit must not embed an onboarding key'
fi
# The bootstrap credential lives on tmpfs, never in persistent storage.
grep -Eq '^EnvironmentFile=-/run/' "$unit" || die 'the bootstrap EnvironmentFile must live under /run'
if grep -Eq '^EnvironmentFile=-/etc/' "$unit"; then
  die 'the bootstrap credential must not be loaded from persistent storage'
fi
pass 'systemd-unit root-owned order docker /run-bootstrap-env'

# The library default must itself be the transient path, with no override.
default_env="$(env -u PERIPHERY_RUN_DIR bash -c 'source "$1/lib.sh"; printf "%s" "$periphery_bootstrap_env"' _ "$ROOT")"
[[ "$default_env" == '/run/komodo/periphery-bootstrap.env' ]] \
  || die "the default bootstrap credential path is not transient: $default_env"
pass 'bootstrap-env-path-is-tmpfs'

# ---------------------------------------------------------------------------
# D. onboarding lifecycle, driven through the real install.sh
#
# Completion is a durable marker, never the identity file: Periphery v2.3.3
# generates periphery.key during startup, so a failed first attempt leaves an
# identity behind. These cases pin the whole state machine, including the
# half-bootstrap retry that identity-only logic would wedge.
# ---------------------------------------------------------------------------
sha=0123456789abcdef0123456789abcdef01234567
fixture_secret='fixture-onboarding-key-do-not-persist'
marker_content='komodo-periphery-onboarding-v1'
stub="$work/bin"
mkdir -p "$stub"

cat > "$stub/systemctl" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
state="${STUB_STATE:?}"
mkdir -p "$state"
# Record whether the durable completion marker already exists, so a fixture can
# prove the marker is written LAST.
marker_note() {
  if [[ -f "${STUB_MARKER:?}" ]]; then printf 'marker=present'; else printf 'marker=absent'; fi
}
# The process environment systemd produces for the unit: the EnvironmentFile is
# copied into it, and STUB_ENVIRON_MODE models the degraded variants.
write_environ() {
  local target="$1"
  case "${STUB_ENVIRON_MODE:-clean}" in
    dirty) printf 'PERIPHERY_ONBOARDING_KEY=%s\0' 'stale-key' > "$target" ;;
    missing) rm -f "$target" ;;
    directory) rm -f "$target"; mkdir -p "$target" ;;
    *) printf 'PATH=/usr/bin\0' > "$target" ;;
  esac
}
command="${1:-}"; shift || true
case "$command" in
  daemon-reload) exit 0 ;;
  enable) : > "$state/enabled"; printf 'enable %s\n' "$(marker_note)" >> "$state/events"; exit 0 ;;
  is-enabled) [[ -f "$state/enabled" ]] && exit 0 || exit 1 ;;
  is-active) [[ -f "$state/active" ]] && exit 0 || exit 1 ;;
  show)
    if [[ " $* " == *" -p User "* ]]; then echo "${STUB_UNIT_USER:-root}"; exit 0; fi
    if [[ -f "$state/active" ]]; then echo "${STUB_MAIN_PID:-4242}"; else echo 0; fi
    ;;
  stop)
    printf 'stop %s\n' "$(marker_note)" >> "$state/events"
    if [[ "${STUB_STOP_FAILS:-false}" == true ]]; then
      printf 'stop-failed %s\n' "$(marker_note)" >> "$state/events"
      exit 1
    fi
    rm -f "$state/active"
    ;;
  kill)
    printf 'kill\n' >> "$state/events"
    if [[ "${STUB_KILL_FAILS:-false}" == true ]]; then
      exit 1
    fi
    rm -f "$state/active"
    ;;
  status) echo 'fixture periphery status'; exit 0 ;;
  start|restart)
    # A restart replaces the process: the previous instance stops first, so the
    # outbound connection has to be re-established afterwards.
    rm -f "$state/active"
    pid="${STUB_MAIN_PID:-4242}"
    proc_env="${STUB_PROC:?}/$pid/environ"
    mkdir -p "$(dirname "$proc_env")"
    if [[ -f "${STUB_BOOTSTRAP_ENV:?}" ]]; then
      printf 'restart-with-bootstrap %s\n' "$(marker_note)" >> "$state/events"
      if [[ "${STUB_SIMULATE_ONBOARDING:-true}" == true ]]; then
        printf '%s\n' 'fixture-periphery-identity' > "${STUB_IDENTITY:?}"
        printf '%s\n' 'fixture-core-public-key' > "${STUB_CORE_PUB:?}"
      fi
      # systemd copies the bootstrap EnvironmentFile into the process environment.
      printf 'PERIPHERY_ONBOARDING_KEY=%s\0' "${STUB_BOOTSTRAP_VALUE:-fixture-key}" > "$proc_env"
      : > "$state/active"
    else
      printf 'restart-without-bootstrap %s\n' "$(marker_note)" >> "$state/events"
      write_environ "$proc_env"
      # A credential-free start that cannot hold the connection must not be
      # mistaken for a committed bootstrap.
      if [[ "${STUB_BREAK_CREDENTIAL_FREE:-false}" != true ]]; then
        : > "$state/active"
      fi
    fi
    exit 0
    ;;
esac
exit 0
STUB
chmod +x "$stub/systemctl"

cat > "$stub/ss" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
# Listener probe (`-l`) must report nothing: outbound-only mode binds no port.
for arg in "$@"; do
  [[ "$arg" == -*l* ]] && exit 0
done
# Established probe: report a connection to the pinned Core when "running".
if [[ -f "${STUB_STATE:?}/active" ]]; then
  printf 'ESTAB 0 0 10.20.0.1:44321 10.20.0.2:9120 users:(("periphery",pid=%s,fd=9))\n' "${STUB_MAIN_PID:-4242}"
fi
exit 0
STUB
chmod +x "$stub/ss"

# read_profile <target>: the effective reviewed parameters of a target profile,
# exactly as the workflow derives them (no fixture overrides in scope).
read_profile() {
  local out="$work/profile-$1.out"
  rm -f "$out"
  env -u PERIPHERY_LOCK_ROOT -u PERIPHERY_STAGING_ROOT \
    bash "$ROOT/read-target-profile.sh" "$1" "$out" >/dev/null \
    || die "reading the $1 target profile failed"
  cat "$out"
}

profile_field() { sed -n "s/^$2=//p" <<<"$1"; }

# prepare_case <name> [target]: a disposable host tree plus a staged runtime +
# artifact for one target. The lock root and staging root are fixture-local, so no
# real host path is touched; the profile's own values are asserted separately.
prepare_case() {
  local name="$1" target="${2:-yecao}"
  case_target="$target"
  case_dir="$work/case-$name-$target"
  rm -rf "$case_dir"
  mkdir -p "$case_dir"/{etc/keys,bin,unit,run,opt,state,stage,proc,lock,staging}
  # The host's deploy owner owns the mutation lock; Periphery only ever locks it.
  : > "$case_dir/lock/.deploy.lock"
  mkdir -p "$case_dir/stage/deploy"
  cp -a "$ROOT" "$case_dir/stage/deploy/periphery"
  artifact="$case_dir/stage/periphery-x86_64"
  # The stub binary reports the manifest's own version so verify.sh can run it.
  manifest_version="$(sed -n 's/^PERIPHERY_VERSION=//p' "$ROOT/periphery.release")"
  printf '#!/bin/sh\nif [ "${1:-}" = "--version" ]; then echo "periphery %s"; exit 0; fi\necho fixture-periphery\n' \
    "$manifest_version" > "$artifact"
  chmod 0755 "$artifact"
  # Fixture manifest: identical contract, but pinned to the fake artifact.
  local artifact_sha
  artifact_sha="$(sha256sum "$artifact" | awk '{print $1}')"
  sed "s/^PERIPHERY_SHA256=.*/PERIPHERY_SHA256=$artifact_sha/" \
    "$ROOT/periphery.release" > "$case_dir/stage/deploy/periphery/periphery.release"
  runtime="$case_dir/stage/deploy/periphery"
  bin_path="$case_dir/bin/periphery"
  identity="$case_dir/etc/keys/periphery.key"
  core_pub="$case_dir/etc/keys/core.pub"
  marker="$case_dir/etc/keys/onboarding-complete"
  bootstrap_env="$case_dir/run/periphery-bootstrap.env"
  events="$case_dir/state/events"
  proc_environ="$case_dir/proc/4242/environ"
  # Target-specific values, straight from the reviewed profile.
  local profile
  profile="$(read_profile "$target")"
  case_connect_as="$(profile_field "$profile" connect_as)"
  case_lock_root="$case_dir/lock"
  case_lock_file="$case_lock_root/.deploy.lock"
  case_staging_root="$case_dir/staging"
  # Stub knobs, set by a case before it calls run_install.
  stub_environ_mode=clean
  stub_stop_fails=false
  stub_kill_fails=false
  stub_simulate=true
  stub_break_free=false
}

# The fixture writes the same marker the host does: reviewed content, mode 0600.
write_marker() {
  printf '%s\n' "$marker_content" > "$marker"
  chmod 600 "$marker"
}

marker_is_valid() {
  [[ -f "$marker" && -s "$marker" && ! -L "$marker" ]] || return 1
  [[ "$(stat -c '%a' "$marker")" == 600 ]] || return 1
  [[ "$(cat "$marker")" == "$marker_content" ]] || return 1
  return 0
}

# run_install [onboarding-key]
#
# Behaviour knobs come from the per-case `stub_*` variables set by prepare_case,
# so a case reads as a list of assignments followed by one call.
run_install() {
  local key="${1:-}"
  env \
    PATH="$stub:$PATH" \
    PERIPHERY_ETC_DIR="$case_dir/etc" \
    PERIPHERY_BIN_PATH="$bin_path" \
    PERIPHERY_UNIT_DIR="$case_dir/unit" \
    PERIPHERY_RUN_DIR="$case_dir/run" \
    PERIPHERY_LOCK_ROOT="$case_lock_root" \
    PERIPHERY_STAGING_ROOT="$case_staging_root" \
    PERIPHERY_PROC_ROOT="$case_dir/proc" \
    PERIPHERY_SYSTEMCTL="$stub/systemctl" \
    PERIPHERY_ONBOARD_ATTEMPTS=3 \
    PERIPHERY_ONBOARD_SLEEP_SECONDS=0 \
    PERIPHERY_VERIFY_ATTEMPTS=3 \
    PERIPHERY_VERIFY_SLEEP_SECONDS=0 \
    PERIPHERY_STOP_ATTEMPTS=3 \
    PERIPHERY_STOP_SLEEP_SECONDS=0 \
    STUB_STATE="$case_dir/state" \
    STUB_BOOTSTRAP_ENV="$bootstrap_env" \
    STUB_IDENTITY="$identity" \
    STUB_CORE_PUB="$core_pub" \
    STUB_MARKER="$marker" \
    STUB_PROC="$case_dir/proc" \
    STUB_SIMULATE_ONBOARDING="$stub_simulate" \
    STUB_BREAK_CREDENTIAL_FREE="$stub_break_free" \
    STUB_ENVIRON_MODE="$stub_environ_mode" \
    STUB_STOP_FAILS="$stub_stop_fails" \
    STUB_KILL_FAILS="$stub_kill_fails" \
    KOMODO_PERIPHERY_ONBOARDING_KEY="$key" \
    bash "$runtime/install.sh" "$case_target" "$sha" "$runtime" "$artifact" \
    >"$case_dir/install.log" 2>&1
}

# marker_fingerprint: a value that changes if the marker is created, replaced, or
# modified, including by a symlink.
marker_fingerprint() {
  if [[ -e "$marker" || -L "$marker" ]]; then
    sha256sum "$marker" 2>/dev/null || printf 'unsafe-or-unreadable'
  else
    printf 'absent'
  fi
}

# fail_closed <label> [onboarding-key]: the run must fail before any host mutation.
# Passing a key proves the credential cannot rescue an unsafe or corrupted state.
fail_closed() {
  local label="$1" key="${2:-}" marker_before marker_after
  marker_before="$(marker_fingerprint)"
  if run_install "$key"; then
    die "$label must fail closed"
  fi
  [[ ! -e "$bin_path" ]] || die "$label installed the binary"
  [[ ! -e "$case_dir/etc/periphery.config.toml" ]] || die "$label installed the config"
  [[ ! -e "$bootstrap_env" ]] || die "$label wrote a bootstrap credential"
  marker_after="$(marker_fingerprint)"
  [[ "$marker_before" == "$marker_after" ]] || die "$label modified the onboarding marker"
}

# D1. Completed install (marker + identity + core.pub), no GitHub secret.
prepare_case completed
printf '%s\n' 'fixture-periphery-identity' > "$identity"
printf '%s\n' 'fixture-core-public-key' > "$core_pub"
write_marker
state_before="$(sha256sum "$identity" "$core_pub" "$marker" | sha256sum)"
if ! run_install; then
  cat "$case_dir/install.log" >&2
  die 'a completed install must reconcile without the onboarding secret'
fi
[[ "$(sha256sum "$identity" "$core_pub" "$marker" | sha256sum)" == "$state_before" ]] \
  || die 'ordinary reconcile modified the identity, the pinned Core key, or the completion marker'
marker_is_valid || die 'ordinary reconcile damaged the completion marker'
[[ ! -e "$bootstrap_env" ]] || die 'ordinary reconcile created a bootstrap credential'
if grep -q 'restart-with-bootstrap' "$events"; then
  die 'ordinary reconcile restarted Periphery with a bootstrap credential'
fi
[[ -x "$bin_path" ]] || die 'ordinary reconcile did not install the binary'
cmp -s "$bin_path" "$artifact" || die 'the installed binary does not match the staged artifact'
[[ -f "$case_dir/state/enabled" ]] || die 'the unit was not enabled'
grep -q '^restart-without-bootstrap marker=present$' "$events" \
  || die 'the completed service was left stopped after the binary was replaced'
pass 'yecao-completed reconciles-without-secret and preserves identity+marker after the K3.2 refactor'

# D2. Half-bootstrap (identity present, marker absent) and no secret: fail closed.
prepare_case half-bootstrap-no-secret
printf '%s\n' 'fixture-periphery-identity' > "$identity"
printf '%s\n' 'fixture-core-public-key' > "$core_pub"
identity_before="$(sha256sum "$identity" | awk '{print $1}')"
fail_closed 'half-bootstrap without an onboarding key'
grep -q 'onboarding has not completed' "$case_dir/install.log" \
  || { cat "$case_dir/install.log" >&2; die 'the fail-closed reason was not reported'; }
[[ "$(sha256sum "$identity" | awk '{print $1}')" == "$identity_before" ]] \
  || die 'the fail-closed path regenerated the identity'
pass 'half-bootstrap-missing-secret fails-closed without touching the identity'

# D3. Fresh install: bootstrap, drop the credential, prove the reconnect, commit LAST.
prepare_case fresh
run_install "$fixture_secret" || {
  cat "$case_dir/install.log" >&2
  die 'first onboarding with a valid onboarding key failed'
}
[[ -f "$identity" && -s "$identity" ]] || die 'onboarding did not produce a persistent identity'
[[ -f "$core_pub" && -s "$core_pub" ]] || die 'onboarding did not pin the Core public key'
[[ ! -e "$bootstrap_env" ]] || die 'the bootstrap credential survived onboarding'
marker_is_valid || die 'onboarding did not commit a valid completion marker'
[[ -f "$case_dir/state/enabled" ]] || die 'the unit was not enabled after commit'
grep -q '^restart-with-bootstrap marker=absent$' "$events" || die 'onboarding never used the bootstrap credential'
grep -q '^restart-without-bootstrap marker=absent$' "$events" \
  || die 'Periphery was not restarted credential-free before the marker was written'
if grep -q 'marker=present' <(grep '^restart-' "$events"); then
  die 'the onboarding marker was written before a Periphery restart'
fi
grep -q '^enable marker=present$' "$events" || die 'the unit was enabled before onboarding committed'
if grep -q '^enable marker=absent$' "$events"; then
  die 'the unit was enabled before onboarding committed'
fi
# The credential must never reach persistent state or a log. The staged tree is
# excluded: it is transient git content, and this very fixture lives in it.
if grep -rq -- "$fixture_secret" "$case_dir/etc" "$case_dir/unit" "$case_dir/run" \
   "$case_dir/state" "$case_dir/install.log"; then
  die 'the onboarding key was persisted or logged'
fi
pass 'fresh-install bootstraps then commits the marker last'

# D4. Failed bootstrap already produced an identity: the next reconcile MUST retry
# with the secret, reusing that identity instead of wedging the host.
for variant in with-core-pub identity-only; do
  prepare_case "half-bootstrap-retry-$variant"
  printf '%s\n' 'fixture-periphery-identity' > "$identity"
  if [[ "$variant" == with-core-pub ]]; then
    printf '%s\n' 'fixture-core-public-key' > "$core_pub"
  fi
  identity_before="$(sha256sum "$identity" | awk '{print $1}')"
  run_install "$fixture_secret" || {
    cat "$case_dir/install.log" >&2
    die "a half-bootstrap ($variant) must be retried with the onboarding key"
  }
  grep -q '^restart-with-bootstrap marker=absent$' "$events" \
    || die "a half-bootstrap ($variant) did not retry onboarding"
  [[ "$(sha256sum "$identity" | awk '{print $1}')" == "$identity_before" ]] \
    || die "the retry regenerated the identity ($variant)"
  marker_is_valid || die "the retry did not commit the marker ($variant)"
  grep -q 'Reusing the Komodo Periphery identity' "$case_dir/install.log" \
    || die "the retry did not report identity reuse ($variant)"
done
pass 'half-bootstrap-with-secret retries onboarding and reuses the identity'

# D5/D6. Corrupted completed state: marker present, key material missing.
for missing in identity core-pub; do
  prepare_case "corrupt-completed-$missing"
  printf '%s\n' 'fixture-periphery-identity' > "$identity"
  printf '%s\n' 'fixture-core-public-key' > "$core_pub"
  write_marker
  if [[ "$missing" == identity ]]; then
    rm -f "$identity"
  else
    rm -f "$core_pub"
  fi
  fail_closed "a completed marker with a missing $missing" "$fixture_secret"
  grep -q 'Corrupted Komodo Periphery state' "$case_dir/install.log" \
    || { cat "$case_dir/install.log" >&2; die "the corrupted-state reason was not reported ($missing)"; }
done
pass 'corrupt-completed-state fails-closed without regenerating anything'

# D7. Onboarding never completes: bounded wait, credential removed, service stopped.
prepare_case onboarding-timeout
stub_simulate=false
if run_install "$fixture_secret"; then
  die 'a Periphery that never onboarded must fail the reconcile'
fi
[[ ! -e "$bootstrap_env" ]] || die 'the bootstrap credential was left behind after a failed onboarding'
[[ ! -e "$marker" ]] || die 'a failed onboarding committed the marker'
grep -q '^stop ' "$events" || die 'a failed onboarding left the service running'
[[ ! -f "$case_dir/state/active" ]] || die 'a failed onboarding left an active process holding the credential'
if grep -rq -- "$fixture_secret" "$case_dir/etc" "$case_dir/unit"; then
  die 'the onboarding key was persisted after a failed onboarding'
fi
pass 'incomplete-onboarding stops the service and leaves no live credential'

# D8. The credential-free restart fails: the marker must stay absent.
prepare_case credential-free-failure
stub_break_free=true
if run_install "$fixture_secret"; then
  die 'a failed credential-free restart must fail the reconcile'
fi
[[ ! -e "$marker" ]] || die 'the marker was committed although the credential-free restart never connected'
[[ ! -e "$bootstrap_env" ]] || die 'the bootstrap credential was left behind'
grep -q '^stop ' "$events" || die 'the failed credential-free restart left the service running'
pass 'credential-free-restart-failure leaves the commit marker absent'

# D8b. The credential survives in the process environment after the file is
# removed: the bootstrap must not commit, and the service must be stopped.
prepare_case credential-in-process-env
stub_environ_mode=dirty
if run_install "$fixture_secret"; then
  die 'a process still carrying the bootstrap credential must fail the reconcile'
fi
[[ ! -e "$marker" ]] || die 'the marker was committed while the process still carried the credential'
[[ ! -e "$bootstrap_env" ]] || die 'the bootstrap credential file was left behind'
grep -q '^stop ' "$events" || die 'a process still carrying the credential was left running'
pass 'credential-left-in-process-env fails the bootstrap and stops the service'

# D8c/D8d. The process environment cannot be inspected: that is not evidence of
# absence, so the bootstrap must fail closed and stop the service.
for mode in missing directory; do
  prepare_case "env-unreadable-$mode"
  stub_environ_mode="$mode"
  if run_install "$fixture_secret"; then
    die "an uninspectable process environment ($mode) must fail the reconcile"
  fi
  [[ ! -e "$marker" ]] || die "the marker was committed with an uninspectable environment ($mode)"
  [[ ! -e "$bootstrap_env" ]] || die "the bootstrap credential file was left behind ($mode)"
  grep -q '^stop ' "$events" || die "an uninspectable environment left the service running ($mode)"
  [[ ! -f "$case_dir/state/active" ]] || die "an uninspectable environment left an active process ($mode)"
done
pass 'uninspectable-process-env fails-closed and stops the service'

# D8e. A plain stop that does not take effect must be followed by a force-kill,
# because the running process may still hold the bootstrap credential.
prepare_case stop-ineffective
stub_simulate=false
stub_stop_fails=true
if run_install "$fixture_secret"; then
  die 'a failed onboarding whose stop did not take effect must fail the reconcile'
fi
grep -q '^stop-failed ' "$events" || die 'the fixture never exercised an ineffective stop'
grep -q '^kill$' "$events" || die 'an ineffective stop was not followed by a force-kill'
[[ ! -f "$case_dir/state/active" ]] || die 'the force-kill did not clear the active state'
[[ ! -e "$bootstrap_env" ]] || die 'the bootstrap credential file was left behind'
[[ ! -e "$marker" ]] || die 'the marker was committed after a failed bootstrap'
pass 'ineffective-stop is escalated to a force-kill that clears the process'

# D8f. If even the force-kill cannot clear the unit, cleanup must say so loudly.
prepare_case kill-ineffective
stub_simulate=false
stub_stop_fails=true
stub_kill_fails=true
if run_install "$fixture_secret"; then
  die 'a failed onboarding that cannot be terminated must fail the reconcile'
fi
grep -q '^kill$' "$events" || die 'the fixture never attempted the force-kill'
grep -q 'CRITICAL' "$case_dir/install.log" \
  || { cat "$case_dir/install.log" >&2; die 'an unterminated credential-bearing process was not reported as CRITICAL'; }
[[ ! -e "$bootstrap_env" ]] || die 'the bootstrap credential file was left behind'
[[ ! -e "$marker" ]] || die 'the marker was committed after a failed bootstrap'
pass 'unterminated-credential-process is reported as CRITICAL'

# D9. Unsafe or unexpected markers must fail closed.
prepare_case marker-symlink
printf '%s\n' 'fixture-periphery-identity' > "$identity"
printf '%s\n' 'fixture-core-public-key' > "$core_pub"
printf '%s\n' "$marker_content" > "$work/real-marker"
chmod 600 "$work/real-marker"
ln -s "$work/real-marker" "$marker"
fail_closed 'a symlinked completion marker' "$fixture_secret"

prepare_case marker-dangling
printf '%s\n' 'fixture-periphery-identity' > "$identity"
printf '%s\n' 'fixture-core-public-key' > "$core_pub"
ln -s "$case_dir/etc/keys/absent-marker" "$marker"
fail_closed 'a dangling completion marker symlink' "$fixture_secret"

prepare_case marker-wrong-content
printf '%s\n' 'fixture-periphery-identity' > "$identity"
printf '%s\n' 'fixture-core-public-key' > "$core_pub"
printf '%s\n' 'komodo-periphery-onboarding-v0' > "$marker"
chmod 600 "$marker"
fail_closed 'a completion marker with unexpected content' "$fixture_secret"

prepare_case marker-wrong-mode
printf '%s\n' 'fixture-periphery-identity' > "$identity"
printf '%s\n' 'fixture-core-public-key' > "$core_pub"
printf '%s\n' "$marker_content" > "$marker"
chmod 644 "$marker"
fail_closed 'a completion marker with unsafe permissions' "$fixture_secret"
grep -q 'Corrupted Komodo Periphery onboarding marker' "$case_dir/install.log" \
  || { cat "$case_dir/install.log" >&2; die 'the unsafe-marker reason was not reported'; }
pass 'unsafe-or-unexpected-markers fail-closed'

# ---------------------------------------------------------------------------
# E. ":8120 has no listener" is a real probe, not a string assertion
# ---------------------------------------------------------------------------
if command -v python3 >/dev/null && command -v ss >/dev/null; then
  python3 -c '
import socket, time
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", 8120))
s.listen(1)
time.sleep(30)
' &
  probe_pid=$!
  bound=false
  for _ in $(seq 1 20); do
    if [[ -n "$(bash -c 'source "$1/lib.sh"; listener_on_8120' _ "$ROOT")" ]]; then
      bound=true
      break
    fi
    sleep 0.5
  done
  if [[ "$bound" != true ]]; then
    die 'the :8120 listener probe did not detect a deliberately bound port'
  fi
  kill "$probe_pid" 2>/dev/null || true
  wait "$probe_pid" 2>/dev/null || true
  probe_pid=
  released=false
  for _ in $(seq 1 20); do
    if [[ -z "$(bash -c 'source "$1/lib.sh"; listener_on_8120' _ "$ROOT")" ]]; then
      released=true
      break
    fi
    sleep 0.5
  done
  [[ "$released" == true ]] || die 'the :8120 listener probe did not clear after the port was released'
  pass 'no-inbound-8120 probe detects and clears a real listener'
else
  die 'python3 and ss are required to prove the :8120 guard'
fi

# ---------------------------------------------------------------------------
# F. production verification contract
# ---------------------------------------------------------------------------
# Every production check must keep its own observable evidence line and its real
# probe, so a verification step cannot be dropped silently.
verify_script="$ROOT/verify.sh"
for expected in \
  'PASS periphery-binary-sha256' \
  'PASS periphery-version' \
  'PASS periphery-systemd' \
  'PASS periphery-persistent-identity' \
  'PASS periphery-onboarding-complete' \
  'PASS periphery-process-env-clean' \
  'periphery_marker_state' \
  'process_env_is_clean' \
  'process_env_state_label' \
  'periphery_docker_socket' \
  'periphery_connect_as' \
  'periphery_config_source' \
  'PASS periphery-outbound-connected' \
  'PASS periphery-no-inbound-8120' \
  'PASS periphery-config-$periphery_target' \
  'PASS periphery-no-persisted-onboarding-key' \
  'PASS periphery-docker-access' \
  'sha256sum "$periphery_bin"' \
  'periphery_bin" --version' \
  'service_enabled' \
  'service_active' \
  'require_real_file "$periphery_identity"' \
  'require_real_file "$periphery_core_pub"' \
  'established_core_connections' \
  'listener_on_8120' \
  '^PERIPHERY_ONBOARDING_KEY=' \
  'docker info' \
  'Requires=docker.service'; do
  grep -Fq -- "$expected" "$verify_script" "$ROOT/periphery.service" "$ROOT/lib.sh" \
    || die "production verification lost: $expected"
done
# The effective config must be compared with the reviewed per-target config.
grep -Fq 'cmp -s "$periphery_config" "$periphery_config_source"' "$verify_script" \
  || die 'verify.sh must compare the effective config with the target config'
# Verification must never reach for a Komodo admin credential.
if grep -Eq 'KOMODO_(INIT_ADMIN_PASSWORD|JWT_SECRET|WEBHOOK_SECRET|DATABASE_PASSWORD)' "$verify_script"; then
  die 'production verification must not use a Komodo admin/API credential'
fi
# The durable commit point has exactly one definition, and no code path may treat
# the identity file as proof that onboarding completed.
grep -Fq 'komodo-periphery-onboarding-v1' "$ROOT/lib.sh" \
  || die 'the onboarding marker content is not pinned in lib.sh'
grep -Fq 'periphery_marker="$periphery_etc/keys/onboarding-complete"' "$ROOT/lib.sh" \
  || die 'the onboarding marker path is not pinned in lib.sh'
grep -Fq 'must run as root' "$ROOT/reconcile.sh" \
  || die 'reconcile.sh must assert that it runs as root'
# Completion is derived from the durable marker, never from the identity file; the
# half-bootstrap cases above prove the behaviour dynamically.
grep -Fq 'marker_state="$(periphery_marker_state)"' "$ROOT/install.sh" \
  || die 'install.sh must derive onboarding completion from the durable marker'
grep -Fq 'case "$marker_state" in' "$ROOT/install.sh" \
  || die 'install.sh must branch on the durable marker state'
# One lifecycle implementation: no per-host script may exist.
if compgen -G "$ROOT/*yecao*" >/dev/null || compgen -G "$ROOT/*tx1*" >/dev/null; then
  die 'per-host lifecycle scripts must not exist; only reviewed target profiles may'
fi
# The TX1 privilege path must exist and must never put the credential in argv: the
# runtime scripts may only ever read the generic variable, never assign it inline.
reconcile_script="$ROOT/reconcile.sh"
grep -Fq 'sudo -n true' "$reconcile_script" \
  || die 'reconcile.sh must fail closed when non-interactive sudo is unavailable'
grep -Fq -- '--preserve-env=KOMODO_PERIPHERY_ONBOARDING_KEY' "$reconcile_script" \
  || die 'reconcile.sh must preserve only the generic credential through the environment'
grep -Fq 'PERIPHERY_PRIVILEGE' "$ROOT/lib.sh" || die 'lib.sh must read the privilege model'
for script in lib.sh install.sh verify.sh reconcile.sh; do
  if grep -q 'KOMODO_PERIPHERY_ONBOARDING_KEY=' "$ROOT/$script"; then
    die "the shared $script must never assign the credential inline (argv/disk leak)"
  fi
done
pass 'verification-contract all checks keep real probes and one lifecycle'

# The inspection root and the Docker socket must default to the production paths;
# the overrides exist only so this fixture can drive the real code.
default_proc="$(env -u PERIPHERY_PROC_ROOT bash -c 'source "$1/lib.sh"; printf "%s" "$periphery_proc_root"' _ "$ROOT")"
[[ "$default_proc" == '/proc' ]] || die "the process-inspection root is not /proc: $default_proc"
default_socket="$(env -u PERIPHERY_DOCKER_SOCKET bash -c 'source "$1/lib.sh"; printf "%s" "$periphery_docker_socket"' _ "$ROOT")"
[[ "$default_socket" == '/var/run/docker.sock' ]] \
  || die "the Docker socket default is not /var/run/docker.sock: $default_socket"
pass 'production defaults for the /proc root and the Docker socket'

# ---------------------------------------------------------------------------
# G. production verify.sh, executed against a fixture host tree
# ---------------------------------------------------------------------------
# verify.sh is the last line of defence, so it is run for real rather than only
# grepped, for both targets: against a provably credential-free process (must pass)
# and with an environment that cannot be inspected (must fail hard).
verify_case() {
  local name="$1" mode="$2" target="${3:-yecao}" attempt
  prepare_case "verify-$name" "$target"
  install -m 0755 "$artifact" "$bin_path"
  printf '%s\n' 'fixture-periphery-identity' > "$identity"
  printf '%s\n' 'fixture-core-public-key' > "$core_pub"
  write_marker
  install -m 600 "$ROOT/targets/$target/periphery.config.toml" "$case_dir/etc/periphery.config.toml"
  : > "$case_dir/state/active"
  : > "$case_dir/state/enabled"
  mkdir -p "$case_dir/proc/4242"
  case "$mode" in
    missing) rm -f "$proc_environ" ;;
    swapped)
      # Another target's config installed on this host.
      install -m 600 "$ROOT/targets/$( [[ "$target" == yecao ]] && echo tx1 || echo yecao )/periphery.config.toml" \
        "$case_dir/etc/periphery.config.toml"
      printf 'PATH=/usr/bin\0' > "$proc_environ" ;;
    *) printf 'PATH=/usr/bin\0' > "$proc_environ" ;;
  esac
  printf '#!/usr/bin/env bash\nexit 0\n' > "$stub/docker"
  chmod +x "$stub/docker"
  # A real unix socket, so the Docker access check is exercised honestly.
  python3 -c 'import socket, sys, time
s = socket.socket(socket.AF_UNIX)
s.bind(sys.argv[1])
time.sleep(30)' "$case_dir/docker.sock" &
  local sock_pid=$!
  for attempt in $(seq 1 20); do
    [[ -S "$case_dir/docker.sock" ]] && break
    sleep 0.5
  done
  env \
    PATH="$stub:$PATH" \
    PERIPHERY_ETC_DIR="$case_dir/etc" \
    PERIPHERY_BIN_PATH="$bin_path" \
    PERIPHERY_UNIT_DIR="$case_dir/unit" \
    PERIPHERY_RUN_DIR="$case_dir/run" \
    PERIPHERY_LOCK_ROOT="$case_lock_root" \
    PERIPHERY_STAGING_ROOT="$case_staging_root" \
    PERIPHERY_PROC_ROOT="$case_dir/proc" \
    PERIPHERY_DOCKER_SOCKET="$case_dir/docker.sock" \
    PERIPHERY_SYSTEMCTL="$stub/systemctl" \
    PERIPHERY_VERIFY_ATTEMPTS=2 \
    PERIPHERY_VERIFY_SLEEP_SECONDS=0 \
    STUB_STATE="$case_dir/state" \
    STUB_MARKER="$marker" \
    STUB_PROC="$case_dir/proc" \
    bash "$ROOT/verify.sh" "$target" "$runtime" >"$case_dir/verify.log" 2>&1
  local status=$?
  kill "$sock_pid" 2>/dev/null || true
  wait "$sock_pid" 2>/dev/null || true
  return "$status"
}

for target in "${targets[@]}"; do
  if ! verify_case "clean-$target" clean "$target"; then
    cat "$case_dir/verify.log" >&2
    die "verify.sh must pass against a credential-free $target fixture host"
  fi
  grep -q "PASS periphery-config-$target" "$case_dir/verify.log" \
    || die "verify.sh did not report the $target config check"
  grep -q 'PASS periphery-process-env-clean' "$case_dir/verify.log" \
    || die 'verify.sh did not report the credential-free process environment'
done
if verify_case unreadable missing; then
  cat "$case_dir/verify.log" >&2
  die 'verify.sh must fail when the process environment cannot be inspected'
fi
grep -q 'cannot prove the running Periphery process is credential-free' "$case_dir/verify.log" \
  || { cat "$case_dir/verify.log" >&2; die 'the uninspectable-environment diagnostic was not reported'; }
if verify_case swapped swapped tx1; then
  cat "$case_dir/verify.log" >&2
  die 'verify.sh must fail when another target profile is installed'
fi
grep -q 'is not the reviewed tx1 config' "$case_dir/verify.log" \
  || { cat "$case_dir/verify.log" >&2; die 'the cross-target config diagnostic was not reported'; }
pass 'verify.sh runs per target and fails-closed on unreadable env and swaps'

# ---------------------------------------------------------------------------
# H. multi-target contract (K3.2)
# ---------------------------------------------------------------------------
# 1. The reviewed profiles are the single source of per-host parameters. Every
# target's values are pinned here independently of the profile text, so a new host
# cannot be added, or an existing one changed, without this contract noticing.
yecao_profile="$(read_profile yecao)"
tx1_profile="$(read_profile tx1)"
tx2_profile="$(read_profile tx2)"
for pairs in \
  "yecao:connect_as:yecao" "yecao:lock_root:/opt/wotb" \
  "yecao:staging_root:/opt/periphery" "yecao:privilege:root" \
  "tx1:connect_as:tx1" "tx1:lock_root:/opt/wotb-tx" \
  "tx1:staging_root:/opt/wotb-tx/periphery" "tx1:privilege:sudo" \
  "tx2:connect_as:tx2" "tx2:lock_root:/opt/wotb-tx2" \
  "tx2:staging_root:/opt/wotb-tx2/periphery" "tx2:privilege:sudo"; do
  target="${pairs%%:*}"; rest="${pairs#*:}"; field="${rest%%:*}"; want="${rest#*:}"
  case "$target" in
    yecao) profile="$yecao_profile" ;;
    tx1) profile="$tx1_profile" ;;
    tx2) profile="$tx2_profile" ;;
    *) die "unexpected target in the profile contract: $target" ;;
  esac
  actual="$(profile_field "$profile" "$field")"
  [[ "$actual" == "$want" ]] || die "the $target profile must declare $field='$want', not '$actual'"
done
# Every target serializes on its own host lock; none may share or borrow one.
yecao_lock="$(profile_field "$yecao_profile" lock_root)"
tx1_lock="$(profile_field "$tx1_profile" lock_root)"
tx2_lock="$(profile_field "$tx2_profile" lock_root)"
[[ "$yecao_lock" != "$tx1_lock" && "$tx1_lock" != "$tx2_lock" && "$yecao_lock" != "$tx2_lock" ]] \
  || die 'each target must serialize on its own host lock'
# Every target has its own staging root as well.
yecao_staging="$(profile_field "$yecao_profile" staging_root)"
tx1_staging="$(profile_field "$tx1_profile" staging_root)"
tx2_staging="$(profile_field "$tx2_profile" staging_root)"
[[ "$yecao_staging" != "$tx1_staging" && "$tx1_staging" != "$tx2_staging" && "$yecao_staging" != "$tx2_staging" ]] \
  || die 'each target must have its own staging root'
pass "target-profiles reviewed-lock-staging-privilege (${targets[*]})"

# 2. Profiles are data: a credential or a mismatched declaration is refused.
# The synthetic profiles carry complete roots on purpose, so the rejection can only
# come from the declaration being wrong, never from an unrelated missing field.
bad_roots=': "${PERIPHERY_LOCK_ROOT:=/tmp/fixture-lock}"
: "${PERIPHERY_STAGING_ROOT:=/tmp/fixture-staging}"
'
for bad_profile in credential mismatched-name mismatched-connect-as; do
  bad="$work/bad-profile-$bad_profile"
  rm -rf "$bad"
  mkdir -p "$bad/targets/bad"
  cp "$ROOT/lib.sh" "$ROOT/read-target-profile.sh" "$bad/"
  case "$bad_profile" in
    credential)
      printf 'PERIPHERY_TARGET=bad\nPERIPHERY_CONNECT_AS=bad\nPERIPHERY_PRIVILEGE=root\n%sPERIPHERY_DB_PASSWORD=x\n' "$bad_roots" ;;
    mismatched-name)
      printf 'PERIPHERY_TARGET=other\nPERIPHERY_CONNECT_AS=bad\nPERIPHERY_PRIVILEGE=root\n%s' "$bad_roots" ;;
    mismatched-connect-as)
      printf 'PERIPHERY_TARGET=bad\nPERIPHERY_CONNECT_AS=tx1\nPERIPHERY_PRIVILEGE=root\n%s' "$bad_roots" ;;
  esac > "$bad/targets/bad/target.env"
  if bash "$bad/read-target-profile.sh" bad "$work/bad.out" >/dev/null 2>&1; then
    die "an invalid target profile was accepted: $bad_profile"
  fi
done
pass 'target-profiles reject credentials and mismatches'

# 3. Target isolation: another target's config must be refused before mutation.
prepare_case isolation-swap yecao
cp "$ROOT/targets/tx1/periphery.config.toml" "$runtime/targets/yecao/periphery.config.toml"
fail_closed 'a staged config for another target' "$fixture_secret"
grep -q 'must set connect_as' "$case_dir/install.log" \
  || { cat "$case_dir/install.log" >&2; die 'the cross-target config was not reported'; }
pass 'cross-target-config fails-closed before mutation'

# 4. The host lock is the profile's, and a held lock stops the reconcile.
prepare_case lock-contract yecao
printf '%s\n' 'fixture-periphery-identity' > "$identity"
printf '%s\n' 'fixture-core-public-key' > "$core_pub"
write_marker
flock -n "$case_lock_file" -c 'sleep 10' &
lock_pid=$!
for attempt in $(seq 1 20); do
  flock -n "$case_lock_file" -c true 2>/dev/null || break
  sleep 0.2
done
if run_install; then
  kill "$lock_pid" 2>/dev/null || true
  die 'a reconcile must refuse to run while the host lock is held'
fi
kill "$lock_pid" 2>/dev/null || true
wait "$lock_pid" 2>/dev/null || true
grep -q 'Another yecao host mutation is running' "$case_dir/install.log" \
  || { cat "$case_dir/install.log" >&2; die 'the held-lock failure was not reported'; }
# The lock belongs to the host's deploy owner: a missing one is a misconfiguration,
# and Periphery must not create it as root.
rm -f "$case_lock_file"
if run_install; then
  die 'a missing host mutation lock must fail closed instead of being created'
fi
grep -q 'the host mutation lock is missing or unsafe' "$case_dir/install.log" \
  || { cat "$case_dir/install.log" >&2; die 'the missing-lock failure was not reported'; }
[[ ! -e "$case_lock_file" ]] || die 'Periphery must never create the host mutation lock'
pass 'host-lock serialization is taken from the target profile'

# 5/6. First onboarding, then a later secret-free reconcile, for every sudo target.
# K3.2 proved it for TX1; K3.3 requires exactly the same for TX2 through the same
# lifecycle code, so the cases are driven by the reviewed target list.
for target in tx1 tx2; do
  prepare_case "$target-first-onboarding" "$target"
  run_install "$fixture_secret" || {
    cat "$case_dir/install.log" >&2
    die "$target first onboarding with the $target credential failed"
  }
  marker_is_valid || die "$target onboarding did not commit a valid marker"
  cmp -s "$case_dir/etc/periphery.config.toml" "$ROOT/targets/$target/periphery.config.toml" \
    || die "$target must install the reviewed $target config"
  grep -q "^connect_as = \"$target\"\$" "$case_dir/etc/periphery.config.toml" \
    || die "$target must install connect_as = \"$target\""
  [[ ! -e "$bootstrap_env" ]] || die "the $target bootstrap credential survived onboarding"
  grep -q '^restart-with-bootstrap marker=absent$' "$events" \
    || die "$target never used the bootstrap credential"
  if grep -q 'marker=present' <(grep '^restart-' "$events"); then
    die "the $target marker was written before a restart"
  fi
  grep -q '^enable marker=present$' "$events" || die "$target enabled the unit before committing"
  if grep -rq -- "$fixture_secret" "$case_dir/etc" "$case_dir/unit" "$case_dir/run" "$case_dir/state"; then
    die "the $target onboarding key was persisted or logged"
  fi
  pass "$target-first-onboarding commits the marker last with connect_as=$target"

  prepare_case "$target-completed" "$target"
  printf '%s\n' 'fixture-periphery-identity' > "$identity"
  printf '%s\n' 'fixture-core-public-key' > "$core_pub"
  write_marker
  state_before="$(sha256sum "$identity" "$core_pub" "$marker" | sha256sum)"
  if ! run_install; then
    cat "$case_dir/install.log" >&2
    die "a completed $target install must reconcile without any onboarding secret"
  fi
  [[ "$(sha256sum "$identity" "$core_pub" "$marker" | sha256sum)" == "$state_before" ]] \
    || die "the secret-free $target reconcile modified the identity, the Core key, or the marker"
  if grep -q 'restart-with-bootstrap' "$events"; then
    die "the secret-free $target reconcile used a bootstrap credential"
  fi
  pass "$target-completed reconciles without any onboarding secret"
done

# 7. One lifecycle implementation: no host identity may leak into the shared code.
for script in lib.sh install.sh verify.sh reconcile.sh staging-root.sh read-target-profile.sh; do
  if grep -Eq '"yecao"|"tx1"|"tx2"' "$ROOT/$script"; then
    die "the shared $script must not hardcode a host identity"
  fi
done
for script in lib.sh install.sh verify.sh reconcile.sh; do
  grep -Fq 'periphery_target' "$ROOT/$script" \
    || die "the shared $script must be target-driven"
done
pass 'one-lifecycle shared implementation with per-host profiles'

# ---------------------------------------------------------------------------
# I. consecutive reconcile of a completed host (production run 37069234437)
# ---------------------------------------------------------------------------
# Production regression: the second reconcile of an already-completed host stopped
# Periphery in order to "atomically" replace an unchanged binary, and then decided
# no restart was needed — leaving the service down. This drives the real install
# twice per target and requires the second run to be a no-op for a healthy service.
#
# events_since <line-count-before>: the stub systemd events added by one run.
events_since() {
  tail -n "+$(( $1 + 1 ))" "$events"
}

for target in "${targets[@]}"; do
  prepare_case "consecutive-$target" "$target"
  printf '%s\n' 'fixture-periphery-identity' > "$identity"
  printf '%s\n' 'fixture-core-public-key' > "$core_pub"
  write_marker

  # First reconcile converges: exact binary/config/unit, service up, unit enabled.
  if ! run_install; then
    cat "$case_dir/install.log" >&2
    die "the first $target reconcile failed"
  fi
  [[ -f "$case_dir/state/active" ]] || die "the first $target reconcile left the service inactive"
  [[ -f "$case_dir/state/enabled" ]] || die "the first $target reconcile left the unit disabled"
  cmp -s "$bin_path" "$artifact" || die "the first $target reconcile installed the wrong binary"
  cmp -s "$case_dir/etc/periphery.config.toml" "$ROOT/targets/$target/periphery.config.toml" \
    || die "the first $target reconcile installed the wrong config"
  cmp -s "$case_dir/unit/periphery.service" "$ROOT/periphery.service" \
    || die "the first $target reconcile installed the wrong unit"
  grep -q '^restart-without-bootstrap marker=present$' "$events" \
    || die "the first $target reconcile did not bring the service up"
  state_before="$(sha256sum "$identity" "$core_pub" "$marker" | sha256sum)"
  events_before="$(wc -l < "$events")"

  # Second reconcile: identical inputs, no onboarding credential, service already
  # active and already at the desired state.
  if ! run_install; then
    cat "$case_dir/install.log" >&2
    die "the idempotent second $target reconcile failed"
  fi
  [[ -f "$case_dir/state/active" ]] \
    || die "the idempotent second $target reconcile left the service stopped (production run 37069234437)"
  [[ -f "$case_dir/state/enabled" ]] || die "the idempotent second $target reconcile disabled the unit"
  [[ "$(sha256sum "$identity" "$core_pub" "$marker" | sha256sum)" == "$state_before" ]] \
    || die "the idempotent second $target reconcile modified identity/core.pub/marker"
  [[ ! -e "$bootstrap_env" ]] || die "the idempotent second $target reconcile created a bootstrap credential"
  second_events="$(events_since "$events_before")"
  if grep -qE '^(restart|stop|kill)' <<<"$second_events"; then
    die "the idempotent second $target reconcile disturbed the service: $second_events"
  fi
  if grep -q 'restart-with-bootstrap' <<<"$second_events"; then
    die "the idempotent second $target reconcile attempted onboarding"
  fi

  # The other direction must still hold: a real desired-state change is applied.
  events_before="$(wc -l < "$events")"
  printf '\n# desired-state change for the fixture\n' >> "$runtime/periphery.service"
  if ! run_install; then
    cat "$case_dir/install.log" >&2
    die "the $target reconcile after a desired-state change failed"
  fi
  grep -q '^restart-without-bootstrap marker=present$' <<<"$(events_since "$events_before")" \
    || die "a changed unit for $target must restart the service"
  [[ -f "$case_dir/state/active" ]] || die "the $target service is inactive after applying a change"

  # And a stopped service with otherwise-correct state must still be brought up.
  events_before="$(wc -l < "$events")"
  rm -f "$case_dir/state/active"
  if ! run_install; then
    cat "$case_dir/install.log" >&2
    die "the $target reconcile of a stopped service failed"
  fi
  [[ -f "$case_dir/state/active" ]] || die "an inactive $target service must be started by the reconcile"
  grep -q '^restart-without-bootstrap marker=present$' <<<"$(events_since "$events_before")" \
    || die "the $target reconcile must restart an inactive service"
done
pass "consecutive-reconcile keeps a completed service active and untouched (${targets[*]})"

echo 'Komodo Periphery contract fixtures: PASS'
