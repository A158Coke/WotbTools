#!/usr/bin/env bash
# Build and publish the Frontend on TX from an exact commit mirrored to Gitee.
# GitHub remains the release authority; Gitee is only the domestic source transport.
# The pinned Agent WASM release archive is staged by GitHub because it is tiny; the
# expensive frontend image build and TCR publication stay entirely inside China.
set -Eeuo pipefail

readonly GITEE_REPO_URL="${WOTB_GITEE_REPO_URL:-https://gitee.com/A158Coke/Wotbtools.git}"
# Share the exact-source cache and host build lock with the Business API builder.
# TX is the constrained production builder; two application images must not compete
# for CPU/RAM or maintain duplicate Gitee clones when the same main commit touches both.
readonly CACHE_ROOT="${WOTB_TX_BUILD_CACHE_ROOT:-$HOME/.cache/wotbtools-production-build}"
readonly REPO_DIR="$CACHE_ROOT/repo"
readonly BUILD_LOCK_FILE="$CACHE_ROOT/build.lock"
readonly GITEE_WAIT_ATTEMPTS="${GITEE_WAIT_ATTEMPTS:-12}"
readonly GITEE_WAIT_INTERVAL_SECONDS="${GITEE_WAIT_INTERVAL_SECONDS:-15}"
readonly GIT_FETCH_TIMEOUT_SECONDS="${GIT_FETCH_TIMEOUT_SECONDS:-60}"
readonly TCR_PUSH_TIMEOUT_SECONDS="${TCR_PUSH_TIMEOUT_SECONDS:-600}"
readonly TCR_LOOKUP_TIMEOUT_SECONDS="${TCR_LOOKUP_TIMEOUT_SECONDS:-60}"
readonly TCR_PULL_TIMEOUT_SECONDS="${TCR_PULL_TIMEOUT_SECONDS:-300}"
readonly KILL_AFTER_SECONDS="${KILL_AFTER_SECONDS:-30}"
readonly RETRY_MAX_ATTEMPTS="${RETRY_MAX_ATTEMPTS:-3}"
readonly RETRY_BACKOFF_FIRST_SECONDS="${RETRY_BACKOFF_FIRST_SECONDS:-5}"
readonly RETRY_BACKOFF_LATER_SECONDS="${RETRY_BACKOFF_LATER_SECONDS:-15}"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

is_transient_tcr_failure() {
  grep -Eqi \
    '(timeout awaiting response headers|tls handshake timeout|i/o timeout|read timeout|write timeout|connection (reset|refused|timed out|timeout)|connection reset by peer|broken pipe|unexpected (end of stream|EOF)|remote host terminated|network is unreachable|temporary failure|server misbehaving|no such host|too many requests|toomanyrequests|(http|status code)[:= ]+(429|5[0-9][0-9])|(429|5[0-9][0-9])[[:space:]]+(too many requests|internal server error|bad gateway|service unavailable|gateway time-?out)|internal server error|bad gateway|service unavailable|gateway time-?out|received unexpected http status)' \
    <<<"$1"
}

run_tcr_stage() {
  local stage_name="$1"
  shift
  local attempt=1 output_file output status backoff

  while :; do
    printf 'stage=%s attempt=%s/%s\n' "$stage_name" "$attempt" "$RETRY_MAX_ATTEMPTS"
    output_file="$(mktemp)"
    if "$@" >"$output_file" 2>&1; then
      cat "$output_file"
      rm -f "$output_file"
      printf 'stage=%s result=PASS attempts=%s\n' "$stage_name" "$attempt"
      return 0
    else
      status=$?
    fi
    output="$(<"$output_file")"
    rm -f "$output_file"
    printf '%s\n' "$output" >&2

    if [ "$attempt" -ge "$RETRY_MAX_ATTEMPTS" ] \
      || { [ "$status" -ne 124 ] && [ "$status" -ne 137 ] && ! is_transient_tcr_failure "$output"; }; then
      printf 'stage=%s result=FAIL attempts=%s status=%s\n' "$stage_name" "$attempt" "$status" >&2
      return "$status"
    fi

    if [ "$attempt" -eq 1 ]; then backoff="$RETRY_BACKOFF_FIRST_SECONDS"; else backoff="$RETRY_BACKOFF_LATER_SECONDS"; fi
    printf 'stage=%s result=RETRY backoff_seconds=%s\n' "$stage_name" "$backoff" >&2
    sleep "$backoff"
    attempt=$((attempt + 1))
  done
}

validate_asset_base_url() {
  local value="$1"
  [ -n "$value" ] || die "ASSET_BASE_URL is required"
  case "$value" in https://*) ;; *) die "ASSET_BASE_URL must use https://" ;; esac
  case "$value" in *[[:space:]]*) die "ASSET_BASE_URL must not contain whitespace" ;; esac
  [ "${value%/}" = "$value" ] || die "ASSET_BASE_URL must not end with /"
}

validate_common() {
  local source_sha="$1" registry="$2" namespace="$3" asset_base_url="$4" agent_archive="$5"

  [[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || die "source SHA must be a full lowercase commit SHA"
  [[ "$registry" =~ ^([a-z0-9][a-z0-9-]*\.)+tencentyun\.com$ ]] || die "registry must be a Tencent TCR host"
  [[ "$namespace" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "invalid TCR namespace"
  validate_asset_base_url "$asset_base_url"
  [ -f "$agent_archive" ] || die "staged Agent WASM release archive is missing"

  local setting
  for setting in GITEE_WAIT_ATTEMPTS GITEE_WAIT_INTERVAL_SECONDS GIT_FETCH_TIMEOUT_SECONDS \
    TCR_PUSH_TIMEOUT_SECONDS TCR_LOOKUP_TIMEOUT_SECONDS TCR_PULL_TIMEOUT_SECONDS KILL_AFTER_SECONDS \
    RETRY_MAX_ATTEMPTS RETRY_BACKOFF_FIRST_SECONDS RETRY_BACKOFF_LATER_SECONDS; do
    is_positive_integer "${!setting}" || die "$setting must be a positive integer"
  done
  [ "$RETRY_MAX_ATTEMPTS" -le 3 ] || die "RETRY_MAX_ATTEMPTS cannot exceed 3"

  for command_name in git docker timeout flock python3 sha256sum grep; do
    command -v "$command_name" >/dev/null || die "$command_name is required"
  done
  docker version >/dev/null
  docker buildx version >/dev/null
}

# Sponsor 运行时内容（收款码 + 配置）由 GitHub 在构建期从 CI secrets 注入并 stage 过来：
# 它既不能进 Git，又必须真的出现在镜像里（Web 同源伺服）。这里校验「staged 包 = 声明的指纹」，
# 并把指纹纳入镜像 identity —— 换码必须换 tag、必须重建，不能被 immutable tag 复用悄悄吞掉。
validate_sponsor_bundle() {
  local bundle="$1" fingerprint="$2"

  if [ -z "$bundle" ]; then
    [ -z "$fingerprint" ] || die "sponsor bundle fingerprint requires a staged bundle"
    return 0
  fi
  [ -f "$bundle" ] || die "staged sponsor runtime content bundle is missing"
  [[ "$fingerprint" =~ ^[0-9a-f]{64}$ ]] || die "sponsor bundle fingerprint must be a full sha256"
  [ "$(sha256sum "$bundle" | cut -d' ' -f1)" = "$fingerprint" ] \
    || die "staged sponsor bundle sha256 does not match the announced fingerprint"
}

# 构建上下文里的内容来自外部 staged 输入，必须 fail closed：只接受 sponsor-config.json 与
# sponsor-assets/ 下的普通文件/目录，拒绝符号链接、绝对路径与 .. 逃逸。
unpack_sponsor_bundle() {
  local bundle="$1" target="$2"

  python3 - "$bundle" <<'PY_SPONSOR'
import sys, tarfile

with tarfile.open(sys.argv[1], "r:gz") as archive:
    for member in archive.getmembers():
        name = member.name
        # GNU tar 会为目录写一条**不带尾随斜杠**的条目（`sponsor-assets`），与
        # scripts/ci/inject-sponsor-runtime-content.sh 的白名单保持一致。
        if not (name == "sponsor-config.json" or name == "sponsor-assets" or name.startswith("sponsor-assets/")):
            raise SystemExit(f"unexpected entry in sponsor bundle: {name}")
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"unsupported entry type in sponsor bundle: {name}")
        if name.startswith("/") or ".." in name.split("/"):
            raise SystemExit(f"unsafe entry path in sponsor bundle: {name}")
PY_SPONSOR
  tar -xzf "$bundle" -C "$target"
  [ -s "$target/sponsor-config.json" ] || die "sponsor bundle did not provide sponsor-config.json"
}

wait_for_gitee_sha() {
  local source_sha="$1"
  local attempt

  mkdir -p "$CACHE_ROOT"
  if [ ! -d "$REPO_DIR/.git" ]; then
    mkdir -p "$REPO_DIR"
    git -C "$REPO_DIR" init -q
    git -C "$REPO_DIR" remote add origin "$GITEE_REPO_URL"
    echo "repo_state=cold"
  else
    [ "$(git -C "$REPO_DIR" remote get-url origin)" = "$GITEE_REPO_URL" ] \
      || die "unexpected Gitee origin in persistent frontend production build repo"
    echo "repo_state=warm"
  fi

  for attempt in $(seq 1 "$GITEE_WAIT_ATTEMPTS"); do
    echo "gitee_sync attempt=$attempt/$GITEE_WAIT_ATTEMPTS source_sha=$source_sha"
    if timeout "$GIT_FETCH_TIMEOUT_SECONDS" env GIT_TERMINAL_PROMPT=0 \
      git -C "$REPO_DIR" fetch --no-tags --prune origin \
      +refs/heads/main:refs/remotes/origin/main; then
      if git -C "$REPO_DIR" cat-file -e "$source_sha^{commit}" 2>/dev/null \
        && git -C "$REPO_DIR" merge-base --is-ancestor "$source_sha" refs/remotes/origin/main; then
        echo "gitee_sync result=PASS tip=$(git -C "$REPO_DIR" rev-parse refs/remotes/origin/main)"
        return 0
      fi
    fi

    if [ "$attempt" -lt "$GITEE_WAIT_ATTEMPTS" ]; then
      sleep "$GITEE_WAIT_INTERVAL_SECONDS"
    fi
  done

  die "source SHA did not reach Gitee main within the bounded wait"
}

lookup_remote_digest() {
  local image="$1"
  local attempt=1 output_file output status digest backoff

  while :; do
    output_file="$(mktemp)"
    if digest="$(timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_LOOKUP_TIMEOUT_SECONDS}s" \
      docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$image" 2>"$output_file")"; then
      rm -f "$output_file"
      [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die "registry returned an invalid digest for $image"
      printf '%s\n' "$digest"
      return 0
    else
      status=$?
    fi
    output="$(<"$output_file")"
    rm -f "$output_file"

    if grep -Eqi '(manifest unknown|name unknown|not found|404)' <<<"$output"; then
      return 10
    fi

    printf '%s\n' "$output" >&2
    if [ "$attempt" -ge "$RETRY_MAX_ATTEMPTS" ] \
      || { [ "$status" -ne 124 ] && [ "$status" -ne 137 ] && ! is_transient_tcr_failure "$output"; }; then
      return "$status"
    fi

    if [ "$attempt" -eq 1 ]; then backoff="$RETRY_BACKOFF_FIRST_SECONDS"; else backoff="$RETRY_BACKOFF_LATER_SECONDS"; fi
    echo "stage=lookup-immutable result=RETRY backoff_seconds=$backoff" >&2
    sleep "$backoff"
    attempt=$((attempt + 1))
  done
}

verify_agent_archive() {
  local worktree="$1" archive="$2"
  local expected_sha expected_asset
  read -r expected_sha expected_asset < <(python3 - "$worktree/deploy/agent/source.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
artifact = data.get("artifact") or {}
print(artifact.get("sha256", ""), artifact.get("asset", ""))
PY
)
  [[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] || die "deploy/agent/source.json has no valid artifact sha256"
  [ -n "$expected_asset" ] || die "deploy/agent/source.json has no artifact asset name"
  printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum -c --quiet \
    || die "staged Agent WASM archive sha256 does not match source.json"
}

verify_frontend_image() {
  local image="$1" source_sha="$2" asset_base_url="$3" sponsor_expected_dir="${4:-}"
  local container temp
  # Agent identity 从**该 source commit 自己的** deploy/agent/source.json 读取：发布证据
  # 链 = source.json ref/release → ZIP fingerprint → common/assets/wasm/<ref>/ →
  # dist/wasm/<ref>/ → 镜像。镜像里必须正好是这个 commit 的产物。
  local agent_ref agent_release
  read -r agent_ref agent_release < <(git -C "$REPO_DIR" show "$source_sha:deploy/agent/source.json" \
    | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data.get("ref", ""), (data.get("artifact") or {}).get("release", ""))
')
  [[ "$agent_ref" =~ ^[0-9a-f]{40}$ ]] || die "source.json at $source_sha has no valid ref"
  [ -n "$agent_release" ] || die "source.json at $source_sha has no artifact.release"

  container="$(docker create "$image")" || die "cannot create verification container from $image"
  temp="$(mktemp -d)"

  if ! (
    set -Eeuo pipefail
    docker cp "$container:/usr/share/nginx/html" "$temp/html"
    grep -Fq "\"buildCommit\": \"$source_sha\"" "$temp/html/version.json"
    grep -R --binary-files=text -Fq "$source_sha" "$temp/html/assets"
    grep -R --binary-files=text -Fq "$asset_base_url" "$temp/html/assets"
    # commit-addressed 产物目录：恰好是 source commit 的 ref，且没有 stable 路径
    [ -d "$temp/html/wasm/$agent_ref" ]
    for file in wotb_replay_wasm.js wotb_replay_wasm_bg.wasm fingerprint.json; do
      [ -s "$temp/html/wasm/$agent_ref/$file" ]
    done
    [ "$(head -c4 "$temp/html/wasm/$agent_ref/wotb_replay_wasm_bg.wasm" | od -An -tx1 | tr -d ' \n')" = "0061736d" ]
    [ ! -e "$temp/html/wasm/wotb_replay_wasm.js" ]
    [ ! -e "$temp/html/wasm/wotb_replay_wasm_bg.wasm" ]
    [ ! -e "$temp/html/wasm/fingerprint.json" ]
    # 目录集合只能是 <ref> 一个（别的 build 的 Agent 不得混进同一镜像）
    [ "$(find "$temp/html/wasm" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort | tr '\n' ' ')" = "$agent_ref " ]
    AGENT_FINGERPRINT="$temp/html/wasm/$agent_ref/fingerprint.json" \
      AGENT_REF="$agent_ref" AGENT_RELEASE="$agent_release" \
      python3 -c '
import json, os, sys
path = os.environ["AGENT_FINGERPRINT"]
ref = os.environ["AGENT_REF"]
release = os.environ["AGENT_RELEASE"]
try:
    fingerprint = json.load(open(path, encoding="utf-8"))
except Exception as exc:
    raise SystemExit("frontend image fingerprint is not readable JSON: %s" % exc)
if fingerprint.get("upstream_commit") != ref:
    raise SystemExit("frontend image fingerprint upstream_commit %r != source.json ref %r" % (fingerprint.get("upstream_commit"), ref))
if fingerprint.get("tag") != release:
    raise SystemExit("frontend image fingerprint tag %r != source.json artifact.release %r" % (fingerprint.get("tag"), release))
'
    for file in index.html version.json sponsor-bg.webp icon.ico icon.png wotbtoolslogo.png; do
      [ -s "$temp/html/$file" ]
    done
    docker cp "$container:/etc/nginx/conf.d/default.conf" "$temp/default.conf"
    [ -s "$temp/default.conf" ]
    # 镜像内 nginx 必须给 commit-addressed 目录 immutable 长缓存（刷新即生效的机制）
    grep -Fq '/wasm/[0-9a-f]{40}/' "$temp/default.conf" \
      || { echo 'frontend image nginx has no commit-addressed /wasm/ cache rule' >&2; exit 1; }
    grep -Fq 'immutable' "$temp/default.conf"
    # Sponsor 运行时内容：**以 staged 包实际声明的文件集为准**（`enabled: false` 的包只有
    # sponsor-config.json，没有 sponsor-assets/），镜像里必须逐文件一致；没 staged 就必须不在
    # （防止陈旧注入物跟着复用 tag 混进发布面）。
    if [ -n "$sponsor_expected_dir" ]; then
      # find 对不存在的路径返回非零（`enabled: false` 的包没有 sponsor-assets/），必须容错；
      # 「包里有配置」由下面的非空断言保证，不靠 find 的退出码。
      sponsor_expected_list="$(cd "$sponsor_expected_dir" && { find sponsor-config.json sponsor-assets -type f 2>/dev/null | LC_ALL=C sort; } || true)"
      [ -n "$sponsor_expected_list" ] || { echo 'staged sponsor bundle carries no sponsor-config.json' >&2; exit 1; }
      sponsor_actual_list="$(cd "$temp/html" && { find sponsor-config.json sponsor-assets -type f 2>/dev/null | LC_ALL=C sort; } || true)"
      [ "$sponsor_expected_list" = "$sponsor_actual_list" ] \
        || { echo "frontend image sponsor file set differs from the staged bundle (expected: $sponsor_expected_list / actual: $sponsor_actual_list)" >&2; exit 1; }
      (cd "$sponsor_expected_dir" && printf '%s\n' "$sponsor_expected_list" | xargs sha256sum) > "$temp/sponsor.expected"
      (cd "$temp/html" && printf '%s\n' "$sponsor_expected_list" | xargs sha256sum) > "$temp/sponsor.actual"
      cmp -s "$temp/sponsor.expected" "$temp/sponsor.actual" \
        || { echo 'frontend image sponsor content does not match the staged bundle' >&2; exit 1; }
    else
      { [ ! -e "$temp/html/sponsor-config.json" ] && [ ! -e "$temp/html/sponsor-assets" ]; } \
        || { echo 'frontend image carries sponsor runtime content that was not staged' >&2; exit 1; }
    fi
  ); then
    docker rm -f "$container" >/dev/null 2>&1 || true
    rm -rf -- "$temp"
    die "frontend image verification failed for $image"
  fi

  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf -- "$temp"
}

build_publish() {
  local source_sha="$1" registry="$2" namespace="$3" asset_base_url="$4" agent_archive="$5"
  local sponsor_bundle="$6" sponsor_fingerprint="$7"
  validate_common "$source_sha" "$registry" "$namespace" "$asset_base_url" "$agent_archive"
  validate_sponsor_bundle "$sponsor_bundle" "$sponsor_fingerprint"

  local identity tag remote_image local_image worktree digest lookup_status reused sponsor_tmp=""
  # identity 纳入 sponsor 内容指纹：换二维码 ⇒ 新 tag ⇒ 必然重建（immutable tag 复用不会把新码
  # 悄悄吞掉）；内容未变 ⇒ 同 tag ⇒ 复用（可复现）。
  identity="$(printf '%s\n%s\n%s' "$source_sha" "$asset_base_url" "$sponsor_fingerprint" | sha256sum | cut -c1-12)"
  tag="sha-$identity"
  remote_image="$registry/$namespace/wotbtools-frontend:$tag"
  local_image="wotbtools-production-frontend:$tag"
  worktree="/tmp/wotbtools-frontend-production-build-${source_sha:0:12}-$$"
  digest=""
  lookup_status=0
  reused=false

  mkdir -p "$CACHE_ROOT"
  exec 8>"$BUILD_LOCK_FILE"
  flock -n 8 || die "another TX Frontend build is already running"

  if [ -n "$sponsor_fingerprint" ]; then
    sponsor_tmp="$(mktemp -d)"
  fi
  cleanup_build_leftovers() {
    local worktree="$1" sponsor_tmp="$2"
    git -C "$REPO_DIR" worktree remove --force "$worktree" >/dev/null 2>&1 || true
    rm -rf -- "$worktree"
    [ -z "$sponsor_tmp" ] || rm -rf -- "$sponsor_tmp"
  }
  # Capture quoted paths now: EXIT runs after build_publish's locals leave scope.
  trap "$(printf 'cleanup_build_leftovers %q %q' "$worktree" "$sponsor_tmp")" EXIT

  if [ -n "$sponsor_fingerprint" ]; then
    unpack_sponsor_bundle "$sponsor_bundle" "$sponsor_tmp"
  fi

  wait_for_gitee_sha "$source_sha"

  lookup_status=0
  digest="$(lookup_remote_digest "$remote_image")" || lookup_status=$?
  case "$lookup_status" in
    0)
      reused=true
      run_tcr_stage pull-existing \
        timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PULL_TIMEOUT_SECONDS}s" \
        docker pull "$remote_image@$digest" >/dev/null
      verify_frontend_image "$remote_image@$digest" "$source_sha" "$asset_base_url" "$sponsor_tmp"
      ;;
    10)
      reused=false
      rm -rf -- "$worktree"
      git -C "$REPO_DIR" worktree add --force --detach "$worktree" "$source_sha" >/dev/null

      [ "$(git -C "$worktree" rev-parse HEAD)" = "$source_sha" ] || die "detached worktree SHA mismatch"
      verify_agent_archive "$worktree" "$agent_archive"
      WOTB_AGENT_ARTIFACT_FILE="$agent_archive" bash "$worktree/scripts/fetch-agent-wasm.sh"
      if [ -n "$sponsor_tmp" ]; then
        # publicDir（common/assets/）——Vite 原样拷进 dist，随镜像进 nginx root。
        mkdir -p "$worktree/common/assets"
        cp -R "$sponsor_tmp/." "$worktree/common/assets/"
      fi

      timeout 1800 docker build \
        --file "$worktree/docker/Dockerfile.frontend" \
        --build-arg "BUILD_COMMIT=$source_sha" \
        --build-arg "ASSET_BASE_URL=$asset_base_url" \
        --tag "$local_image" \
        "$worktree"
      verify_frontend_image "$local_image" "$source_sha" "$asset_base_url" "$sponsor_tmp"

      docker tag "$local_image" "$remote_image"
      run_tcr_stage push-immutable \
        timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PUSH_TIMEOUT_SECONDS}s" docker push "$remote_image"

      digest="$(lookup_remote_digest "$remote_image")" || die "published immutable frontend image is not readable from TCR"
      run_tcr_stage pull-published \
        timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PULL_TIMEOUT_SECONDS}s" \
        docker pull "$remote_image@$digest" >/dev/null
      verify_frontend_image "$remote_image@$digest" "$source_sha" "$asset_base_url" "$sponsor_tmp"
      ;;
    *)
      die "could not determine whether immutable frontend TCR tag already exists"
      ;;
  esac

  printf 'RESULT source_sha=%s\n' "$source_sha"
  printf 'RESULT image=%s\n' "$remote_image"
  printf 'RESULT digest=%s\n' "$digest"
  printf 'RESULT reused=%s\n' "$reused"
  printf 'RESULT build_commit_verified=true\n'
  printf 'RESULT asset_base_url_verified=true\n'
  printf 'RESULT wasm_verified=true\n'
  printf 'RESULT sponsor_runtime_content=%s\n' "$([ -n "$sponsor_fingerprint" ] && echo injected || echo absent)"
}

usage() {
  echo "usage: $0 build-publish <source-sha> <tcr-registry> <tcr-namespace> <asset-base-url> <agent-wasm-archive> <sponsor-bundle|-> <sponsor-fingerprint|->" >&2
  exit 2
}

[ "$#" -eq 8 ] || usage
mode="$1"
shift

case "$mode" in
  build-publish)
    # 第 6/7 个参数是 sponsor 运行时内容（staged bundle 路径 + 指纹）；`-` 或空 = 未配置。
    sponsor_bundle="$6"
    sponsor_fingerprint="$7"
    [ "$sponsor_bundle" != "-" ] || sponsor_bundle=""
    [ "$sponsor_fingerprint" != "-" ] || sponsor_fingerprint=""
    build_publish "$1" "$2" "$3" "$4" "$5" "$sponsor_bundle" "$sponsor_fingerprint"
    ;;
  *) usage ;;
esac
