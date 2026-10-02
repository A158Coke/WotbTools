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
# B. persistent config contract: outbound only, exact Core, no secret
# ---------------------------------------------------------------------------
config="$ROOT/periphery.config.toml"
for expected in \
  '^root_directory = "/etc/komodo"$' \
  '^core_addresses = \["http://10\.20\.0\.2:9120"\]$' \
  '^connect_as = "yecao"$' \
  '^server_enabled = false$' \
  '^private_key = "file:/etc/komodo/keys/periphery\.key"$' \
  '^core_public_keys = \["file:/etc/komodo/keys/core\.pub"\]$' \
  '^disable_terminals = false$' \
  '^disable_container_terminals = false$'; do
  effective "$config" | grep -Eq "$expected" || die "persistent config is missing: $expected"
done
# Exactly one address, and it is the private WireGuard Core.
[[ "$(effective "$config" | grep -cE 'https?://')" == 1 ]] \
  || die 'the persistent config must name exactly one address'
# No inbound server, no public/Jecao address, no wildcard bind, no credentials.
for forbidden in '^bind_ip' '^port[[:space:]]*=' '^allowed_ips[[:space:]]*=[[:space:]]*\[.+\]' \
  '45\.136\.14\.101' 'komodo\.wotbtools\.com' '0\.0\.0\.0' 'onboarding_key' 'passkeys' \
  '\[secrets\]' 'git_provider' 'image_registry'; do
  if effective "$config" | grep -Eq "$forbidden"; then
    die "persistent config must not contain: $forbidden"
  fi
done
pass 'config-outbound-only exact-core-address no-secrets'

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
# ---------------------------------------------------------------------------
sha=0123456789abcdef0123456789abcdef01234567
fixture_secret='fixture-onboarding-key-do-not-persist'
stub="$work/bin"
mkdir -p "$stub"

cat > "$stub/systemctl" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
state="${STUB_STATE:?}"
mkdir -p "$state"
command="${1:-}"; shift || true
case "$command" in
  daemon-reload) exit 0 ;;
  enable) : > "$state/enabled"; exit 0 ;;
  is-enabled) [[ -f "$state/enabled" ]] && exit 0 || exit 1 ;;
  is-active) [[ -f "$state/active" ]] && exit 0 || exit 1 ;;
  show) if [[ -f "$state/active" ]]; then echo "${STUB_MAIN_PID:-4242}"; else echo 0; fi ;;
  stop) rm -f "$state/active"; printf 'stop\n' >> "$state/events"; exit 0 ;;
  start|restart)
    if [[ -f "${STUB_BOOTSTRAP_ENV:?}" ]]; then
      printf 'restart-with-bootstrap\n' >> "$state/events"
      if [[ "${STUB_SIMULATE_ONBOARDING:-true}" == true ]]; then
        printf '%s\n' 'fixture-periphery-identity' > "${STUB_IDENTITY:?}"
        printf '%s\n' 'fixture-core-public-key' > "${STUB_CORE_PUB:?}"
      fi
    else
      printf 'restart-without-bootstrap\n' >> "$state/events"
    fi
    : > "$state/active"
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

# prepare_case <name>: a disposable host tree plus a staged runtime + artifact.
prepare_case() {
  local name="$1"
  case_dir="$work/case-$name"
  rm -rf "$case_dir"
  mkdir -p "$case_dir"/{etc/keys,bin,unit,run,opt,state,stage}
  mkdir -p "$case_dir/stage/deploy"
  cp -a "$ROOT" "$case_dir/stage/deploy/periphery"
  artifact="$case_dir/stage/periphery-x86_64"
  printf '#!/bin/sh\necho fixture-periphery\n' > "$artifact"
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
  bootstrap_env="$case_dir/run/periphery-bootstrap.env"
  events="$case_dir/state/events"
}

run_install() {
  local key="${1:-}" simulate="${2:-true}"
  env \
    PATH="$stub:$PATH" \
    PERIPHERY_ETC_DIR="$case_dir/etc" \
    PERIPHERY_BIN_PATH="$bin_path" \
    PERIPHERY_UNIT_DIR="$case_dir/unit" \
    PERIPHERY_RUN_DIR="$case_dir/run" \
    PERIPHERY_OPT_ROOT="$case_dir/opt" \
    PERIPHERY_WOTB_ROOT="$case_dir/wotb" \
    PERIPHERY_SYSTEMCTL="$stub/systemctl" \
    PERIPHERY_ONBOARD_ATTEMPTS=3 \
    PERIPHERY_ONBOARD_SLEEP_SECONDS=0 \
    STUB_STATE="$case_dir/state" \
    STUB_BOOTSTRAP_ENV="$bootstrap_env" \
    STUB_IDENTITY="$identity" \
    STUB_CORE_PUB="$core_pub" \
    STUB_SIMULATE_ONBOARDING="$simulate" \
    KOMODO_YECAO_ONBOARDING_KEY="$key" \
    bash "$runtime/install.sh" "$sha" "$runtime" "$artifact" >"$case_dir/install.log" 2>&1
}

# D1. Existing identity: onboarding is not required and the identity is preserved.
prepare_case existing-identity
printf '%s\n' 'fixture-periphery-identity' > "$identity"
printf '%s\n' 'fixture-core-public-key' > "$core_pub"
identity_before="$(sha256sum "$identity" | awk '{print $1}')"
core_before="$(sha256sum "$core_pub" | awk '{print $1}')"
if ! run_install; then
  cat "$case_dir/install.log" >&2
  die 'reconcile with an existing identity must not require the onboarding secret'
fi
[[ "$(sha256sum "$identity" | awk '{print $1}')" == "$identity_before" ]] \
  || die 'ordinary reconcile modified the persistent Periphery identity'
[[ "$(sha256sum "$core_pub" | awk '{print $1}')" == "$core_before" ]] \
  || die 'ordinary reconcile modified the pinned Core public key'
[[ ! -e "$bootstrap_env" ]] || die 'ordinary reconcile created a bootstrap credential'
if grep -q 'restart-with-bootstrap' "$events"; then
  die 'ordinary reconcile restarted Periphery with a bootstrap credential'
fi
[[ -x "$bin_path" ]] || die 'ordinary reconcile did not install the binary'
cmp -s "$bin_path" "$artifact" || die 'the installed binary does not match the staged artifact'
[[ -f "$case_dir/state/enabled" ]] || die 'the unit was not enabled'
grep -q 'restart-without-bootstrap' "$events" || die 'the service was left stopped after the binary was replaced'
pass 'reconcile-preserves-identity without-onboarding-secret'

# D2. Missing identity and missing onboarding secret: fail closed, before mutation.
prepare_case missing-identity-no-secret
if run_install; then
  die 'a missing identity without an onboarding key must fail closed'
fi
grep -q 'Refusing to generate a new Server identity' "$case_dir/install.log" \
  || { cat "$case_dir/install.log" >&2; die 'the fail-closed reason was not reported'; }
[[ ! -e "$identity" ]] || die 'a new identity was generated without onboarding'
[[ ! -e "$bootstrap_env" ]] || die 'a bootstrap credential was written without a key'
[[ ! -e "$bin_path" ]] || die 'the binary was installed even though onboarding could not proceed'
[[ ! -e "$case_dir/etc/periphery.config.toml" ]] || die 'the config was installed before the onboarding decision'
pass 'missing-identity-missing-secret fails-closed before mutation'

# D3. Missing identity with the bootstrap secret: onboard once, then drop it.
prepare_case onboarding
run_install "$fixture_secret" || {
  cat "$case_dir/install.log" >&2
  die 'first onboarding with a valid onboarding key failed'
}
[[ -f "$identity" && -s "$identity" ]] || die 'onboarding did not produce a persistent identity'
[[ -f "$core_pub" && -s "$core_pub" ]] || die 'onboarding did not pin the Core public key'
[[ ! -e "$bootstrap_env" ]] || die 'the bootstrap credential survived onboarding'
grep -q 'restart-with-bootstrap' "$events" || die 'onboarding never used the bootstrap credential'
grep -q 'restart-without-bootstrap' "$events" || die 'Periphery was not restarted again without the credential'
# The credential must never reach persistent state or a log. The staged tree is
# excluded: it is transient git content, and this very fixture lives in it.
if grep -rq -- "$fixture_secret" "$case_dir/etc" "$case_dir/unit" "$case_dir/run" \
   "$case_dir/state" "$case_dir/install.log"; then
  die 'the onboarding key was persisted or logged'
fi
pass 'first-onboarding uses-then-removes the bootstrap credential'

# D4. Onboarding that never completes: bounded wait, then fail closed cleanly.
prepare_case onboarding-timeout
if run_install "$fixture_secret" false; then
  die 'a Periphery that never onboarded must fail the reconcile'
fi
[[ ! -e "$bootstrap_env" ]] || die 'the bootstrap credential was left behind after a failed onboarding'
if grep -rq -- "$fixture_secret" "$case_dir/etc" "$case_dir/unit"; then
  die 'the onboarding key was persisted after a failed onboarding'
fi
pass 'incomplete-onboarding fails-closed and removes the credential'

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
# Every K3.1 production check must keep its own observable evidence line and its
# real probe, so a verification step cannot be dropped silently.
verify_script="$ROOT/verify.sh"
for expected in \
  'PASS periphery-binary-sha256' \
  'PASS periphery-version' \
  'PASS periphery-systemd' \
  'PASS periphery-persistent-identity' \
  'PASS periphery-outbound-connected' \
  'PASS periphery-no-inbound-8120' \
  'PASS periphery-config-outbound-only' \
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
  '/proc/$pid/environ' \
  '^PERIPHERY_ONBOARDING_KEY=' \
  '/var/run/docker.sock' \
  'docker info' \
  'Requires=docker.service'; do
  grep -Fq -- "$expected" "$verify_script" "$ROOT/periphery.service" \
    || die "production verification lost: $expected"
done
# Verification must never reach for a Komodo admin credential.
if grep -Eq 'KOMODO_(INIT_ADMIN_PASSWORD|JWT_SECRET|WEBHOOK_SECRET|DATABASE_PASSWORD)' "$verify_script"; then
  die 'production verification must not use a Komodo admin/API credential'
fi
pass 'verification-contract all ten checks keep real probes'

echo 'Komodo Periphery contract fixtures: PASS'
