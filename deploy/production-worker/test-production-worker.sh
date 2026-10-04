#!/usr/bin/env bash
# Fixtures for the production-worker owner (K7A).
#
# Executable rather than string-only: the real `install.sh` / `verify.sh` /
# `reconcile.sh` are driven against a disposable fake host root with stubbed
# docker/systemctl/apt-get/wg/ip/ss, so the fail-closed matrix, the conditional
# Docker restart, credential rotation and the readiness token are checked as
# behaviour. No production secret, no SSH, no real Docker; the only network use is
# loopback listeners this fixture starts itself.
#
# Run as root (the CI job uses sudo): the mode/permission assertions are real, and
# the lifecycle is root-only by design, exactly as Komodo/Periphery runs Docker.
#
# This is the owner's single fixture entrypoint: the checks are production-safety
# invariants that no native validator can carry.
set -Eeuo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ "$(id -u)" == 0 ]] || { echo 'Run the production-worker fixtures as root (sudo).' >&2; exit 2; }

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

work="$(mktemp -d)"
listener_pids=""
cleanup() {
  if [[ -n "$listener_pids" ]]; then kill $listener_pids 2>/dev/null || true; fi
  rm -rf -- "$work"
}
trap cleanup EXIT

SHA=0123456789abcdef0123456789abcdef01234567
REGISTRY=ccr.example.tencentyun.com
NAMESPACE=wotbtools
FAKE_USERNAME=fixture-user
FAKE_PASSWORD=fixture-not-a-real-password
MIRROR=https://mirror.ccs.tencentyun.com

## --- loopback service-plane stand-ins ----------------------------------------

listen_port() {
  # stdout/stderr are detached: the backgrounded listener must not hold this
  # command substitution's pipe open.
  python3 - "$1" >/dev/null 2>&1 <<'PY' &
import socket, sys, time
server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", int(sys.argv[1])))
server.listen(8)
while True:
    try:
        connection, _ = server.accept()
        connection.close()
    except OSError:
        time.sleep(0.05)
PY
  echo $!
}

port_a=19501
port_b=19502
port_c=19503
port_unused=19599
for port in "$port_a" "$port_b" "$port_c"; do
  listener_pids="$listener_pids $(listen_port "$port")"
done
sleep 1
FIXTURE_ENDPOINTS="127.0.0.1:$port_a 127.0.0.1:$port_b 127.0.0.1:$port_c"

## --- fake host root -----------------------------------------------------------

host="$work/host"
lock_root="$host/opt/wotb-tx2"
staging_root="$lock_root/production-worker"
stage="$staging_root/incoming/$SHA"
runtime="$stage/deploy/production-worker"
state="$work/state"
bin="$work/bin"
daemon_config="$host/etc/docker/daemon.json"
root_config="$host/root/.docker/config.json"
mkdir -p "$lock_root" "$state" "$bin" "$host/etc/docker" "$host/root"
: > "$lock_root/.deploy.lock"

write_profile() {
  mkdir -p "$runtime/targets/tx2"
  cat > "$runtime/targets/tx2/target.env" <<PROFILE
# Fixture profile: the same reviewed shape as the production TX2 profile, pointed at
# this fixture's disposable host root and stubbed binaries.
WORKER_TARGET=tx2
WORKER_LOCK_ROOT=$lock_root
WORKER_STAGING_ROOT=$staging_root
WORKER_PRIVILEGE=root
WORKER_COMPOSE_PACKAGE=docker-compose-v2
WORKER_DOCKER_HUB_MIRROR=$MIRROR
WORKER_VERIFY_IMAGE_REPOSITORY=wotbtools-frontend
WORKER_VERIFY_IMAGE_TAG=latest
WORKER_WIREGUARD_ADDRESS=127.0.0.9
WORKER_REQUIRED_ENDPOINTS="$FIXTURE_ENDPOINTS"
WORKER_PERIPHERY_UNIT=periphery
WORKER_PERIPHERY_STATE="$host/etc/komodo/keys/periphery.key $host/etc/komodo/keys/core.pub $host/etc/komodo/periphery.config.toml"
WORKER_READY_TOKEN=TX2_PRODUCTION_WORKER_READY
PROFILE
  mkdir -p "$host/etc/komodo/keys"
  : > "$host/etc/komodo/keys/periphery.key"
  : > "$host/etc/komodo/keys/core.pub"
  : > "$host/etc/komodo/periphery.config.toml"
}

stage_runtime() {
  bash "$ROOT/staging-root.sh" prepare "$SHA" "$staging_root" >/dev/null
  mkdir -p "$runtime"
  local script
  for script in lib.sh staging-root.sh install.sh verify.sh reconcile.sh read-target-profile.sh; do
    cp "$ROOT/$script" "$runtime/$script"
  done
  chmod 700 "$runtime"/*.sh
  write_profile
}

write_daemon() { printf '%s\n' "$1" > "$daemon_config"; }
reviewed_daemon() {
  printf '{\n  "registry-mirrors": [\n    "%s"\n  ]\n}\n' "$MIRROR"
}

## --- stubbed host commands ----------------------------------------------------
#
# Every filesystem effect and every `stat -c '%a'` mode assertion is real: the
# fixture replaces only the commands that would otherwise touch this machine.

cat > "$bin/docker" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
state="${STUB_STATE:?}"
daemon_config="${STUB_DAEMON_CONFIG:?}"
log="$state/docker.log"

mirrors_json() {
  if [[ -n "${STUB_MIRRORS_OVERRIDE:-}" ]]; then printf '%s\n' "$STUB_MIRRORS_OVERRIDE"; return 0; fi
  python3 - "$daemon_config" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        print(json.dumps(json.load(handle).get("registry-mirrors", [])))
except Exception:
    print("[]")
PY
}

# Authentication is derived from the Docker configuration actually in use, exactly as
# the registry sees it: a config whose auth entry is not accepted for pulls fails.
current_auth() {
  python3 - "${DOCKER_CONFIG:-}" <<'PY'
import json, os, sys
path = os.path.join(sys.argv[1], "config.json")
try:
    with open(path, encoding="utf-8") as handle:
        auths = json.load(handle).get("auths", {})
    entry = next(iter(auths.values()), {})
    print(entry.get("auth", "") if isinstance(entry, dict) else "")
except Exception:
    print("")
PY
}

auth_accepted() {
  local present
  present="$(current_auth)"
  [[ -n "$present" ]] || return 1
  if [[ -f "$state/valid_auth" ]]; then
    grep -qxF -- "$present" "$state/valid_auth"
  else
    [[ "$present" == "$STUB_AUTH" ]]
  fi
}

case "${1:-}" in
  compose)
    case "${2:-}" in
      version) echo "compose version" >> "$log"; [[ -f "$state/compose_present" ]] || exit 1; echo 'Docker Compose version v2.24.0'; exit 0 ;;
      ls) echo "compose ls" >> "$log"
          [[ -f "$state/compose_present" ]] || exit 1
          [[ "${STUB_COMPOSE_LS_FAILS:-false}" == true ]] && exit 1
          echo '[]'; exit 0 ;;
    esac
    exit 1 ;;
  info)
    echo "info $*" >> "$log"
    [[ "${STUB_DOCKER_BROKEN:-false}" == true ]] && exit 1
    if [[ "${2:-}" == "--format" ]]; then mirrors_json; exit 0; fi
    exit 0 ;;
  ps)
    echo "ps" >> "$log"
    [[ "${STUB_DOCKER_BROKEN:-false}" == true ]] && exit 1
    [[ -f "$state/containers" ]] && cat "$state/containers"
    [[ -f "$state/new_container" ]] && echo "container-created-by-worker"
    exit 0 ;;
  manifest)
    echo "manifest $*" >> "$log"
    [[ "${2:-}" == inspect ]] || exit 1
    auth_accepted || exit 1
    [[ "${STUB_MANIFEST_FAILS:-false}" == true ]] && exit 1
    echo '{"schemaVersion":2}'; exit 0 ;;
  pull)
    echo "pull $*" >> "$log"
    auth_accepted || exit 1
    [[ "${STUB_PULL_FAILS:-false}" == true ]] && exit 1
    exit 0 ;;
  login)
    echo "login $*" >> "$log"
    case " $* " in *" --password-stdin "*) ;; *) echo 'password must come from stdin' >&2; exit 1 ;; esac
    case " $* " in *"$STUB_PASSWORD"*) echo 'password must never be an argument' >&2; exit 1 ;; esac
    read -r supplied || true
    [[ "$supplied" == "$STUB_PASSWORD" ]] || { echo 'wrong password on stdin' >&2; exit 1; }
    [[ "${STUB_LOGIN_FAILS:-false}" == true ]] && { echo 'unauthorized' >&2; exit 1; }
    mkdir -p "${DOCKER_CONFIG:?}"
    # The installed document carries the credential it was given, exactly like the real
    # CLI: authentication later depends on that entry being accepted for pulls.
    entry="$(printf '%s:%s' "${STUB_USERNAME:-fixture-user}" "$supplied" | base64 | tr -d '\n')"
    printf '{"auths":{"%s":{"auth":"%s"}}}\n' "${STUB_REGISTRY:?}" "$entry" > "$DOCKER_CONFIG/config.json"
    chmod 600 "$DOCKER_CONFIG/config.json"
    exit 0 ;;
esac
exit 1
STUB

cat > "$bin/systemctl" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
state="${STUB_STATE:?}"
case "${1:-}" in
  restart) echo "restart ${2:-}" >> "$state/restarts"
           [[ "${STUB_RESTART_FAILS:-false}" == true ]] && exit 1
           exit 0 ;;
  is-active) [[ -f "$state/unit_active" ]] && exit 0; exit 3 ;;
  is-enabled) [[ -f "$state/unit_enabled" ]] && exit 0; exit 1 ;;
  show) echo "${STUB_PERIPHERY_PID:-4242}"; exit 0 ;;
esac
exit 1
STUB

cat > "$bin/apt-get" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
state="${STUB_STATE:?}"
echo "apt-get $*" >> "$state/apt"
if [[ " $* " == *" install "* ]]; then
  [[ "${STUB_INSTALL_FAILS:-false}" == true ]] && exit 1
  : > "$state/compose_present"
fi
exit 0
STUB

cat > "$bin/wg" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${STUB_NO_WG:-false}" == true ]] && exit 0
[[ "${1:-}" == show ]] && echo wg0
exit 0
STUB

cat > "$bin/ip" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${STUB_WG_ADDR_MISSING:-false}" == true ]] && exit 0
echo "    inet ${STUB_WG_ADDRESS:?}/24 scope global wg0"
exit 0
STUB

cat > "$bin/ss" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
case " $* " in
  *" -Htnp "*)
    [[ "${STUB_NO_CORE_LINK:-false}" == true ]] && exit 0
    echo "ESTAB 0 0 10.20.0.3:41000 10.20.0.1:9120 users:((\"periphery\",pid=${STUB_PERIPHERY_PID:-4242},fd=7))"
    exit 0 ;;
  *" -Hltn "*)
    [[ "${STUB_INBOUND_LISTENER:-false}" == true ]] && echo 'LISTEN 0 4096 *:8120 *:*'
    exit 0 ;;
esac
exit 0
STUB

chmod 700 "$bin"/*

export PATH="$bin:$PATH"
export STUB_STATE="$state"
export STUB_DAEMON_CONFIG="$daemon_config"
export STUB_PASSWORD="$FAKE_PASSWORD"
export STUB_REGISTRY="$REGISTRY"
export STUB_WG_ADDRESS=127.0.0.9
export WORKER_DOCKER_BIN="$bin/docker"
export WORKER_SYSTEMCTL_BIN="$bin/systemctl"
export WORKER_APT_GET_BIN="$bin/apt-get"
export WORKER_WG_BIN="$bin/wg"
export WORKER_IP_BIN="$bin/ip"
export WORKER_DOCKER_DAEMON_DIR="$host/etc/docker"
export WORKER_ROOT_DOCKER_CONFIG_DIR="$host/root/.docker"
export WORKER_STATE_DIR="$host/var/lib/wotbtools-production-worker"
export TCR_REGISTRY="$REGISTRY"
export TCR_NAMESPACE="$NAMESPACE"
export TCR_USERNAME="$FAKE_USERNAME"
export TCR_PASSWORD="$FAKE_PASSWORD"
export STUB_USERNAME="$FAKE_USERNAME"
# The auth entry the fixture's "current GitHub secret" produces, and the default
# accepted set when a case does not pin `state/valid_auth` itself.
STUB_AUTH="$(printf '%s:%s' "$FAKE_USERNAME" "$FAKE_PASSWORD" | base64 | tr -d '\n')"
export STUB_AUTH
# Reviewed generation used by every case that is not specifically about rotation.
export TCR_CREDENTIAL_VERSION=2

# A reviewed worker always finds Periphery healthy: individual cases break it.
: > "$state/unit_active"
: > "$state/unit_enabled"

install_cmd() { env "$@" bash "$runtime/install.sh" tx2 "$SHA" "$stage"; }
verify_cmd() { env "$@" bash "$runtime/verify.sh" tx2 "$stage"; }
reconcile_cmd() { env "$@" bash "$runtime/reconcile.sh" tx2 "$SHA" "$stage"; }

expect_ok() {
  local label="$1" out="$2"; shift 2
  if ! "$@" > "$out" 2>&1; then cat "$out" >&2; fail "$label should have succeeded"; fi
}
expect_fail() {
  local label="$1" needle="$2"; shift 2
  local out="$work/fail.log"
  if "$@" > "$out" 2>&1; then cat "$out" >&2; fail "$label should have failed closed"; fi
  grep -qF -- "$needle" "$out" || { cat "$out" >&2; fail "$label failed without '$needle'"; }
}

stage_runtime

## --- A. reviewed TX2 profile contract ----------------------------------------

bash "$ROOT/read-target-profile.sh" tx2 "$work/profile.out" >/dev/null
for expected in \
  'target=tx2' \
  'lock_root=/opt/wotb-tx2' \
  'staging_root=/opt/wotb-tx2/production-worker' \
  'compose_package=docker-compose-v2' \
  'docker_hub_mirror=https://mirror.ccs.tencentyun.com' \
  'verify_image_repository=wotbtools-frontend' \
  'verify_image_tag=latest' \
  'wireguard_address=10.20.0.3' \
  'ready_token=TX2_PRODUCTION_WORKER_READY'; do
  grep -qxF "$expected" "$work/profile.out" || fail "the TX2 profile must declare $expected"
done
for endpoint in 10.20.0.1:8087 10.20.0.1:8080 10.20.0.2:8089; do
  grep -q "required_endpoints=.*$endpoint" "$work/profile.out" \
    || fail "the TX2 profile must require the frozen K6B endpoint $endpoint"
done
if grep -Eqi '(password|secret|credential)' <(grep -v '^[[:space:]]*#' "$ROOT/targets/tx2/target.env"); then
  fail 'the reviewed TX2 profile must not carry credentials'
fi
pass 'reviewed TX2 profile (frozen K6B endpoints, no credentials)'

cp "$runtime/targets/tx2/target.env" "$work/profile.bak"
printf 'TCR_PASSWORD=fixture\n' >> "$runtime/targets/tx2/target.env"
expect_fail 'a profile carrying a credential' 'must not carry credentials' install_cmd
cp "$work/profile.bak" "$runtime/targets/tx2/target.env"
expect_fail 'an unknown target' 'is not a real file' \
  env bash "$runtime/install.sh" tx9 "$SHA" "$stage"
expect_fail 'a malformed target name' 'Invalid production worker target' \
  env bash "$runtime/install.sh" TX2 "$SHA" "$stage"
expect_fail 'an unknown staging root' 'is not a real file' \
  env bash "$runtime/reconcile.sh" tx2 "$SHA" "$work/elsewhere"
# A stage that exists but does not correspond to the frozen SHA must be refused:
# the staged bytes and the reconciled source identity may never disagree.
OTHER_SHA=89abcdef0123456789abcdef0123456789abcdef
other_stage="$staging_root/incoming/$OTHER_SHA"
bash "$ROOT/staging-root.sh" prepare "$OTHER_SHA" "$staging_root" >/dev/null
mkdir -p "$other_stage/deploy"
cp -r "$runtime" "$other_stage/deploy/production-worker"
expect_fail 'a mismatched staging SHA' 'Unexpected production-worker staging root' \
  env bash "$runtime/reconcile.sh" tx2 "$SHA" "$other_stage"
rm -rf -- "$other_stage"
pass 'profile and staging-root shape refused when wrong'

## --- B. staging-root safety ---------------------------------------------------

rm -rf -- "$stage"
ln -s "$work" "$stage"
expect_fail 'a symlinked staging root' 'missing or unsafe' \
  bash "$ROOT/staging-root.sh" verify "$SHA" "$staging_root"
rm -f "$stage"
stage_runtime
pass 'symlinked staging roots are refused, never followed'

## --- C. host lock -------------------------------------------------------------

mv "$lock_root/.deploy.lock" "$lock_root/.deploy.lock.hidden"
expect_fail 'a missing host lock file' 'lock file does not exist' reconcile_cmd
mv "$lock_root/.deploy.lock.hidden" "$lock_root/.deploy.lock"
pass 'the TX2 host lock must already exist (owned by the deploy owner)'

## --- D. clean bootstrap -------------------------------------------------------

rm -f "$state/compose_present" "$state/auth" "$daemon_config" "$root_config" \
  "$host/var/lib/wotbtools-production-worker/tcr-credential-version" "$state/valid_auth"
: > "$state/restarts"
expect_ok 'a clean worker bootstrap' "$work/bootstrap.log" reconcile_cmd
grep -q 'docker-compose-v2: PASS' "$work/bootstrap.log" || fail 'bootstrap must prove Compose'
grep -q 'apt-get install' "$state/apt" || fail 'missing Compose must be installed from the reviewed package'
grep -q 'docker-hub-mirror: PASS' "$work/bootstrap.log" || fail 'bootstrap must prove the mirror'
grep -q 'tcr-root-auth: PASS' "$work/bootstrap.log" || fail 'bootstrap must prove root TCR auth'
for token in docker-daemon docker-compose-v2 docker-hub-mirror tcr-root-credential \
  private-image-pull periphery-regression wireguard-regression no-workload-created; do
  grep -qxF "$token: PASS" "$work/bootstrap.log" || fail "verification must emit '$token: PASS'"
done
[[ "$(tail -n1 "$work/bootstrap.log")" == 'TX2_PRODUCTION_WORKER_READY' ]] \
  || fail 'the readiness token must be the final line'
[[ "$(cat "$state/restarts")" == 'restart docker' ]] || fail 'the first run must restart Docker once'
[[ "$(stat -c '%a' "$daemon_config")" == 644 ]] || fail 'daemon.json must be mode 644'
[[ "$(stat -c '%a' "$host/root/.docker/config.json")" == 600 ]] || fail 'the credential must be mode 600'
[[ "$(stat -c '%a' "$host/root/.docker")" == 700 ]] || fail 'the credential directory must be mode 700'
diff -q <(reviewed_daemon) "$daemon_config" >/dev/null \
  || fail 'daemon.json must contain exactly the reviewed configuration'
pass 'clean bootstrap (Compose + mirror + root credential + all tokens)'

## --- E. idempotency -----------------------------------------------------------

: > "$state/restarts"
mv "$state/apt" "$state/apt.first"
expect_ok 'a second reconcile' "$work/second.log" reconcile_cmd
[[ ! -s "$state/restarts" ]] || fail 'an already-correct daemon config must not restart Docker'
[[ ! -f "$state/apt" ]] || fail 'an already-available Compose must not be reinstalled'
grep -q 'already available (no install)' "$work/second.log" || fail 'the second run must report no install'
grep -q 'no change (already the reviewed state)' "$work/second.log" || fail 'the second run must not rewrite daemon.json'
grep -q 'no rewrite' "$work/second.log" || fail 'an unchanged credential must not be rewritten'
[[ "$(tail -n1 "$work/second.log")" == 'TX2_PRODUCTION_WORKER_READY' ]] || fail 'the second run must stay ready'
pass 'idempotent reconcile (no restart, no reinstall, no rewrites)'

## --- F. Compose, plugin and daemon health ------------------------------------

rm -f "$state/compose_present"
expect_fail 'a failed Compose install' 'Installing docker-compose-v2 failed' install_cmd STUB_INSTALL_FAILS=true
: > "$state/compose_present"
expect_fail 'an unusable Compose plugin' 'the Compose plugin is not usable' install_cmd STUB_COMPOSE_LS_FAILS=true
expect_fail 'a broken Docker daemon' 'not healthy after reconciliation' install_cmd STUB_DOCKER_BROKEN=true
pass 'Compose install, plugin usability and daemon health fail closed'

## --- G. Docker Hub mirror ----------------------------------------------------

write_daemon "$(printf '{\n  "registry-mirrors": [\n    "https://mirror.example.invalid"\n  ]\n}')"
expect_ok 'a drifted mirror' "$work/mirror-drift.log" install_cmd
grep -q 'mirror: written' "$work/mirror-drift.log" || fail 'a drifted mirror must be corrected'
diff -q <(reviewed_daemon) "$daemon_config" >/dev/null || fail 'the mirror must be restored to the reviewed value'

write_daemon '{"registry-mirrors":["https://drift.invalid"]}'
expect_fail 'a failed Docker restart' 'Restarting the Docker daemon failed' \
  install_cmd STUB_RESTART_FAILS=true
write_daemon "$(printf '{\n  "registry-mirrors": [\n    "%s"\n  ]\n}' "$MIRROR")"

write_daemon '{ not json'
expect_fail 'a malformed daemon config' 'is not valid JSON' install_cmd
write_daemon '{"registry-mirrors":["https://mirror.ccs.tencentyun.com"],"live-restore":true}'
expect_fail 'an unsupported daemon setting' 'does not own these daemon settings' install_cmd
write_daemon '{"registry-mirrors":["https://mirror.ccs.tencentyun.com"]}'
expect_ok 'a supported daemon config' "$work/mirror-ok.log" install_cmd

# Docker's runtime view canonicalizes a registry mirror by appending one trailing
# slash. That representation is equivalent to the reviewed host-only URL, but no
# other scheme/host/path drift is accepted.
expect_ok 'a Docker-canonical trailing slash mirror' "$work/mirror-trailing-slash.log" \
  verify_cmd STUB_MIRRORS_OVERRIDE='["https://mirror.ccs.tencentyun.com/"]'
expect_ok 'an exact active mirror' "$work/mirror-exact.log" \
  verify_cmd STUB_MIRRORS_OVERRIDE='["https://mirror.ccs.tencentyun.com"]'
expect_fail 'an active mirror with a path' 'does not report the reviewed mirror' \
  verify_cmd STUB_MIRRORS_OVERRIDE='["https://mirror.ccs.tencentyun.com/foo"]'
expect_fail 'an active mirror with the wrong scheme' 'does not report the reviewed mirror' \
  verify_cmd STUB_MIRRORS_OVERRIDE='["http://mirror.ccs.tencentyun.com/"]'
expect_fail 'a different active mirror host' 'does not report the reviewed mirror' \
  verify_cmd STUB_MIRRORS_OVERRIDE='["https://other.example.com/"]'
pass 'active mirror canonicalization accepts only one insignificant trailing slash'

pass 'daemon.json is strictly validated (malformed and unsupported settings refuse)'

## --- H. credential model and generation convergence --------------------------
#
# The applied credential generation is authoritative: a reviewed version change MUST
# converge the host even while the previous credential still authenticates. These are
# the regression fixtures for the rotation blocker.

expect_fail 'a missing TCR username' 'TCR_USERNAME is required' install_cmd TCR_USERNAME=
expect_fail 'a missing TCR password' 'TCR_PASSWORD is required' install_cmd TCR_PASSWORD=
expect_fail 'an unreviewed registry' 'must be a Tencent TCR host' install_cmd TCR_REGISTRY=registry.example.invalid
expect_fail 'a missing registry variable' 'TCR_REGISTRY is required' install_cmd TCR_REGISTRY=
expect_fail 'a missing credential version' 'TCR_CREDENTIAL_VERSION must be a reviewed positive integer' \
  install_cmd TCR_CREDENTIAL_VERSION=
expect_fail 'a malformed credential version' 'TCR_CREDENTIAL_VERSION must be a reviewed positive integer' \
  install_cmd TCR_CREDENTIAL_VERSION=../etc
expect_fail 'a zero credential version' 'TCR_CREDENTIAL_VERSION must be a reviewed positive integer' \
  install_cmd TCR_CREDENTIAL_VERSION=0
pass 'credential version is validated (missing, malformed and zero refused)'

# Fresh host: provisioning records generation 2.
marker="$host/var/lib/wotbtools-production-worker/tcr-credential-version"
rm -f "$root_config" "$marker" "$state/valid_auth"
login_count_before="$(grep -c '^login ' "$state/docker.log" || true)"
expect_ok 'provisioning generation 2' "$work/gen2.log" install_cmd TCR_CREDENTIAL_VERSION=2
[[ "$(cat "$marker")" == 2 ]] || fail 'the applied generation must be recorded after a successful login'
[[ "$(grep -c '^login ' "$state/docker.log" || true)" -gt "$login_count_before" ]] \
  || fail 'a fresh host must log in'
pass 'fresh host provisions and records the reviewed generation'

# Unchanged generation: no login, no rewrite, still ready.
digest_before="$(sha256sum "$root_config" | cut -d' ' -f1)"
login_count_before="$(grep -c '^login ' "$state/docker.log" || true)"
expect_ok 'an unchanged generation' "$work/gen2-again.log" install_cmd TCR_CREDENTIAL_VERSION=2
grep -q 'generation 2 already applied and authenticating (no rewrite)' "$work/gen2-again.log" \
  || fail 'an unchanged generation must report no rewrite'
[[ "$(sha256sum "$root_config" | cut -d' ' -f1)" == "$digest_before" ]] \
  || fail 'an unchanged generation must not rewrite the credential'
[[ "$(grep -c '^login ' "$state/docker.log" || true)" == "$login_count_before" ]] \
  || fail 'an unchanged generation must not log in again'
[[ "$(cat "$marker")" == 2 ]] || fail 'an unchanged generation must keep the marker'
pass 'unchanged generation: no login, no rewrite, ready'

# ROTATION WHILE THE OLD CREDENTIAL REMAINS VALID (the blocker regression): the GitHub
# secret becomes a NEW value while the old one is still accepted for pulls, so
# authentication alone would keep the host on generation 2. The reviewed version must
# force the login and install the newly reviewed secret.
old_auth="$(python3 -c 'import json,sys; print(next(iter(json.load(open(sys.argv[1]))["auths"].values()))["auth"])' "$root_config")"
NEW_PASSWORD="fixture-rotated-not-a-real-password"
export TCR_PASSWORD="$NEW_PASSWORD"
export STUB_PASSWORD="$NEW_PASSWORD"
new_auth="$(python3 -c 'import base64,sys; print(base64.b64encode(("%s:%s" % (sys.argv[1], sys.argv[2])).encode()).decode())' "$FAKE_USERNAME" "$NEW_PASSWORD")"
printf '%s\n%s\n' "$old_auth" "$new_auth" > "$state/valid_auth"
expect_ok 'rotation while the old credential still authenticates' "$work/rotate-3.log" \
  reconcile_cmd TCR_CREDENTIAL_VERSION=3
grep -q 'applying generation 3 for ' "$work/rotate-3.log" || fail 'a version change must force a login'
[[ "$(cat "$marker")" == 3 ]] || fail 'a successful rotation must advance the marker to 3'
new_digest="$(sha256sum "$root_config" | cut -d' ' -f1)"
[[ "$new_digest" != "$digest_before" ]] || fail 'a version change must replace the root credential'
[[ "$(python3 -c 'import json,sys; print(next(iter(json.load(open(sys.argv[1]))["auths"].values()))["auth"])' "$root_config")" == "$new_auth" ]] \
  || fail 'the installed credential must be the currently reviewed secret'
[[ "$(tail -n1 "$work/rotate-3.log")" == 'TX2_PRODUCTION_WORKER_READY' ]] || fail 'a rotation must end ready'
pass 'stale marker with a working credential rotates (blocker regression)'

# Second reconcile after the successful rotation: converged, no rewrite.
expect_ok 'after rotation' "$work/after-rotate.log" install_cmd TCR_CREDENTIAL_VERSION=3
grep -q 'generation 3 already applied and authenticating (no rewrite)' "$work/after-rotate.log" \
  || fail 'a converged generation must not rotate again'
[[ "$(sha256sum "$root_config" | cut -d' ' -f1)" == "$new_digest" ]] \
  || fail 'a converged generation must not rewrite the credential'
pass 'second reconcile after rotation: no rewrite, ready'

# Failed rotated login: readiness is false and the marker must not advance.
expect_fail 'a failed rotated login' 'Registry authentication failed' \
  install_cmd TCR_CREDENTIAL_VERSION=4 STUB_LOGIN_FAILS=true
[[ "$(cat "$marker")" == 3 ]] || fail 'a failed login must not advance the marker'
[[ "$(sha256sum "$root_config" | cut -d' ' -f1)" == "$new_digest" ]] \
  || fail 'a failed login must leave the previous credential in place'
rm -f "$state/valid_auth"
pass 'failed rotated login: marker stays, credential unchanged'

# Failed post-install verification: the login succeeds with a credential the registry
# does not (yet) accept for pulls. The run must fail, restore the previous credential
# byte for byte, and keep the marker on the old generation.
THIRD_PASSWORD="fixture-unaccepted-not-a-real-password"
third_auth="$(python3 -c 'import base64,sys; print(base64.b64encode(("%s:%s" % (sys.argv[1], sys.argv[2])).encode()).decode())' "$FAKE_USERNAME" "$THIRD_PASSWORD")"
printf '%s\n' "$new_auth" > "$state/valid_auth"
expect_fail 'a failed post-install verification' 'cannot resolve the private production image' \
  install_cmd TCR_CREDENTIAL_VERSION=5 TCR_PASSWORD="$THIRD_PASSWORD" STUB_PASSWORD="$THIRD_PASSWORD"
[[ "$(cat "$marker")" == 3 ]] || fail 'a failed post-install verification must not advance the marker'
[[ "$(sha256sum "$root_config" | cut -d' ' -f1)" == "$new_digest" ]] \
  || fail 'the previous credential must be restored after a failed post-install verification'
if grep -qF -- "$third_auth" "$root_config"; then
  fail 'the unverified credential must never remain installed'
fi
[[ -z "$(find "$host/var/lib/wotbtools-production-worker" -name 'tcr-credential-backup' 2>/dev/null)" ]] \
  || fail 'the credential backup must not be left behind'
rm -f "$state/valid_auth"
pass 'failed post-install verification: rollback, marker stays'

# Verify refuses a valid credential whose recorded generation is behind.
printf '%s' 2 > "$marker"
chmod 600 "$marker"
expect_fail 'a stale generation marker' 'not the reviewed generation 3' verify_cmd TCR_CREDENTIAL_VERSION=3
printf '%s\n' 3 > "$marker"
chmod 600 "$marker"
pass 'a working credential with a stale marker is never reported ready'

# An unsafe existing credential is an incident, and is never silently replaced.
chmod 644 "$root_config"
expect_fail 'a world-readable credential' 'must be mode 600' install_cmd TCR_CREDENTIAL_VERSION=6
chmod 600 "$root_config"
chmod 755 "$host/root/.docker"
expect_fail 'an unsafe credential directory' 'must be mode 700' verify_cmd TCR_CREDENTIAL_VERSION=3
chmod 700 "$host/root/.docker"
printf '{"auths":{"%s":{"auth":"fixture"},"other.example.com":{"auth":"x"}}}\n' "$REGISTRY" > "$root_config"
chmod 600 "$root_config"
expect_fail 'a credential for an unmanaged registry' 'unmanaged registries' install_cmd TCR_CREDENTIAL_VERSION=6
printf '{"auths":{"%s":{"auth":"fixture"}},"credsStore":"desktop"}\n' "$REGISTRY" > "$root_config"
chmod 600 "$root_config"
expect_fail 'an unsupported credential store' 'unsupported root Docker configuration keys' install_cmd TCR_CREDENTIAL_VERSION=6
pass 'unsafe credential state is refused, never silently replaced'

## --- I. rotation, cleanup and leakage ----------------------------------------

rm -f "$root_config" "$marker"
# The currently reviewed secret is accepted for pulls, so a fresh provisioning is
# verifiable exactly as it is in production.
printf '%s\n' "$new_auth" > "$state/valid_auth"
expect_ok 'a provisioning run' "$work/provision.log" install_cmd TCR_CREDENTIAL_VERSION=6
grep -q 'provisioning generation 6' "$work/provision.log" || fail 'a missing credential must be provisioned'
[[ "$(cat "$marker")" == 6 ]] || fail 'provisioning must record the generation'
for leaked in "$FAKE_PASSWORD" "$FAKE_USERNAME" "$(cat "$root_config")"; do
  for log in "$work"/*.log; do
    if grep -qF -- "$leaked" "$log" 2>/dev/null; then
      fail "credential material leaked into reconcile output: $log"
    fi
  done
done
grep -q 'login .*--password-stdin' "$state/docker.log" || fail 'the login must use --password-stdin'
if grep -qE 'login [^|]*--password[^-]' "$state/docker.log"; then
  fail 'the password must never be passed as a command argument'
fi
[[ -z "$(find "$host/var/lib/wotbtools-production-worker" -type f ! -name 'containers.before' ! -name 'tcr-credential-version' 2>/dev/null)" ]] \
  || fail 'only the container snapshot and the generation marker may persist in the state root'
pass 'rotation works, no credential material persists outside the root Docker config'

# Every later section verifies the host in its converged state, so the reviewed
# generation stays at the one the host actually applied.
export TCR_CREDENTIAL_VERSION=6

## --- J. private image access -------------------------------------------------

expect_fail 'a failed private manifest' 'cannot resolve the private production image' verify_cmd STUB_MANIFEST_FAILS=true
expect_fail 'a failed private pull' 'cannot pull the private production image' verify_cmd STUB_PULL_FAILS=true
# A credential that the registry no longer accepts: the root context is present but
# unauthenticated, so readiness must be refused.
printf 'not-the-accepted-entry\n' > "$state/valid_auth"
expect_fail 'an unauthenticated root context' 'cannot resolve the private production image' verify_cmd
printf '%s\n' "$new_auth" > "$state/valid_auth"
expect_ok 'a working private image path' "$work/verify.log" verify_cmd
grep -qxF 'private-image-pull: PASS' "$work/verify.log" || fail 'the pull proof must be reported'
pass 'authenticated private image access (manifest + pull), unauthenticated refused'

## --- K. readiness token gating ----------------------------------------------

expect_fail 'an unhealthy Docker daemon' 'Docker daemon is not healthy' verify_cmd STUB_DOCKER_BROKEN=true
rm -f "$state/compose_present"
expect_fail 'a missing Compose plugin' 'Compose v2 is unavailable' verify_cmd
: > "$state/compose_present"
mv "$daemon_config" "$daemon_config.hidden"
expect_fail 'a missing daemon config' 'not the reviewed state' verify_cmd
mv "$daemon_config.hidden" "$daemon_config"
write_daemon "$(printf '{\n  "registry-mirrors": [\n    "%s"\n  ]\n}' "$MIRROR")"
# The file may match the reviewed state while the *running* daemon still reports a
# different set (it only reads daemon.json at start): readiness must refuse that.
expect_fail 'a daemon that does not report the reviewed mirror' 'does not report the reviewed mirror' \
  verify_cmd STUB_MIRRORS_OVERRIDE='["https://drift.invalid"]'
chmod 664 "$daemon_config"
expect_fail 'an unsafe daemon config mode' 'must be root:root mode 644' verify_cmd
chmod 644 "$daemon_config"
expect_ok 'a restored worker' "$work/restored.log" verify_cmd
pass 'readiness requires daemon health, Compose, the reviewed mirror and safe modes'

## --- L. Periphery regression -------------------------------------------------

rm -f "$state/unit_active"
expect_fail 'an inactive Periphery unit' 'unit is not active' verify_cmd
: > "$state/unit_active"
rm -f "$state/unit_enabled"
expect_fail 'a disabled Periphery unit' 'unit is not enabled' verify_cmd
: > "$state/unit_enabled"
expect_fail 'a broken Core relationship' 'no established outbound connection' verify_cmd STUB_NO_CORE_LINK=true
expect_fail 'an inbound Periphery listener' 'outbound-only agent' verify_cmd STUB_INBOUND_LISTENER=true
expect_ok 'a healthy Periphery' "$work/periphery.log" verify_cmd
pass 'Periphery regression (active, enabled, outbound link, no :8120 listener)'

## --- M. WireGuard regression -------------------------------------------------

expect_fail 'a missing WireGuard interface' 'No WireGuard interface is present' verify_cmd STUB_NO_WG=true
expect_fail 'a missing reviewed address' 'reviewed WireGuard address' verify_cmd STUB_WG_ADDR_MISSING=true
FIXTURE_ENDPOINTS_SAVED="$FIXTURE_ENDPOINTS"
FIXTURE_ENDPOINTS="127.0.0.1:$port_unused"
write_profile
expect_fail 'an unreachable service-plane endpoint' 'is not reachable' verify_cmd
FIXTURE_ENDPOINTS="$FIXTURE_ENDPOINTS_SAVED"
write_profile
expect_ok 'a healthy WireGuard' "$work/wireguard.log" verify_cmd
pass 'WireGuard regression (interface, reviewed address, endpoint reachability)'

## --- N. no workload created --------------------------------------------------

: > "$state/new_container"
expect_fail 'a container created during reconcile' 'running container set changed' verify_cmd
rm -f "$state/new_container"
# An unrelated container that was already running before the reconcile is not a
# scope violation: readiness compares against the set the reconcile itself found.
printf 'existing-container\n' > "$state/containers"
expect_ok 'an unrelated running container' "$work/unrelated.log" reconcile_cmd
rm -f "$state/containers"
pass 'the worker never creates a workload, and never disturbs an existing one'

## --- O. architectural boundary ----------------------------------------------
#
# The worker owns host Docker prerequisites only. These assertions are structural:
# they fail if the lifecycle ever grows a second responsibility.

for script in lib.sh install.sh verify.sh reconcile.sh staging-root.sh; do
  path="$ROOT/$script"
  code="$(grep -v '^[[:space:]]*#' "$path" || true)"
  for forbidden in 'infra/komodo' 'resource-sync' 'CADDY_' 'TX_BACKEND_UPSTREAM' \
    'periphery.service' 'wg set' 'wg-quick' 'docker compose up' 'docker run ' 'docker start' \
    'system prune' 'docker rm ' 'docker stop ' 'docker volume' 'docker network rm'; do
    if grep -qF -- "$forbidden" <<< "$code"; then
      fail "$script must not reference $forbidden (worker scope is host prerequisites only)"
    fi
  done
  if grep -qE '^[[:space:]]*(set -x|.*komodo[[:space:]]+(apply|sync))' <<< "$code"; then
    fail "$script must not enable tracing or drive Komodo"
  fi
  if grep -qE '>[[:space:]]*/etc/komodo|tee[[:space:]]+/etc/komodo' <<< "$code"; then
    fail "$script must never write Periphery state"
  fi
done
# Scanned over the lifecycle scripts only: this fixture necessarily contains the
# patterns it looks for.
for script in lib.sh staging-root.sh install.sh verify.sh reconcile.sh read-target-profile.sh; do
  path="$ROOT/$script"
  if grep -Fq -- '--password ' "$path"; then
    fail "$script must never pass a password as a command argument"
  fi
  if grep -qE 'echo[^#]*\$\{?TCR_PASSWORD|cat[^#]*\$\{?TCR_PASSWORD' "$path"; then
    fail "$script must never echo the registry credential"
  fi
done
pass 'architectural boundary (no Komodo/Caddy/Periphery/WireGuard/workload ownership)'

## --- P. sudo registry-contract handoff ---------------------------------------
#
# Production runs enter install.sh as the non-root SSH account and then re-exec
# through sudo. Keep this contract structural so CI proves every desired-state
# registry input crosses that boundary, while unrelated environment variables do
# not become part of the allowlist.
install_code="$(cat "$ROOT/install.sh")"
preserve_loop="$(sed -n '/for name in TCR_REGISTRY TCR_NAMESPACE TCR_CREDENTIAL_VERSION TCR_USERNAME TCR_PASSWORD; do/,/done/p' "$ROOT/install.sh")"
[[ -n "$preserve_loop" ]] || fail 'install.sh must explicitly allowlist the complete registry contract for sudo'
for required in TCR_REGISTRY TCR_NAMESPACE TCR_CREDENTIAL_VERSION TCR_USERNAME TCR_PASSWORD; do
  grep -qw "$required" <<< "$preserve_loop" \
    || fail "sudo registry-contract allowlist is missing $required"
done
for forbidden in GITHUB_TOKEN SSH_PRIVATE_KEY WORKER_READY_TOKEN SOURCE_SHA PATH HOME; do
  if grep -qw "$forbidden" <<< "$preserve_loop"; then
    fail "sudo registry-contract allowlist must not preserve unrelated input $forbidden"
  fi
done
grep -q -- '--preserve-env=' <<< "$install_code" \
  || fail 'sudo handoff must use an explicit --preserve-env allowlist'
pass 'sudo handoff preserves the complete registry contract and nothing unrelated'

echo
echo "Production-worker fixtures: PASS"
