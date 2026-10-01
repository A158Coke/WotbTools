#!/usr/bin/env bash
# Build and publish the Business API on TX from an exact commit mirrored to Gitee.
# GitHub remains the release authority; Gitee is only the domestic source transport.
set -Eeuo pipefail

readonly GITEE_REPO_URL="${WOTB_GITEE_REPO_URL:-https://gitee.com/A158Coke/Wotbtools.git}"
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

    if [ "$attempt" -eq 1 ]; then
      backoff="$RETRY_BACKOFF_FIRST_SECONDS"
    else
      backoff="$RETRY_BACKOFF_LATER_SECONDS"
    fi
    printf 'stage=%s result=RETRY backoff_seconds=%s\n' "$stage_name" "$backoff" >&2
    sleep "$backoff"
    attempt=$((attempt + 1))
  done
}

validate_common() {
  local source_sha="$1" registry="$2" namespace="$3"

  [[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || die "source SHA must be a full lowercase commit SHA"
  [[ "$registry" =~ ^([a-z0-9][a-z0-9-]*\.)+tencentyun\.com$ ]] || die "registry must be a Tencent TCR host"
  [[ "$namespace" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "invalid TCR namespace"

  local setting
  for setting in GITEE_WAIT_ATTEMPTS GITEE_WAIT_INTERVAL_SECONDS GIT_FETCH_TIMEOUT_SECONDS \
    TCR_PUSH_TIMEOUT_SECONDS TCR_LOOKUP_TIMEOUT_SECONDS TCR_PULL_TIMEOUT_SECONDS KILL_AFTER_SECONDS \
    RETRY_MAX_ATTEMPTS RETRY_BACKOFF_FIRST_SECONDS RETRY_BACKOFF_LATER_SECONDS; do
    is_positive_integer "${!setting}" || die "$setting must be a positive integer"
  done
  [ "$RETRY_MAX_ATTEMPTS" -le 3 ] || die "RETRY_MAX_ATTEMPTS cannot exceed 3"

  command -v git >/dev/null || die "git is required"
  command -v docker >/dev/null || die "docker is required"
  command -v timeout >/dev/null || die "timeout is required"
  command -v flock >/dev/null || die "flock is required"
  docker version >/dev/null
  docker buildx version >/dev/null
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
      || die "unexpected Gitee origin in persistent production build repo"
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

verify_image_commit() {
  local image="$1" expected_sha="$2"
  local actual
  actual="$(docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | sed -n 's/^BUILD_COMMIT=//p' | head -n1)"
  [ "$actual" = "$expected_sha" ] \
    || die "image BUILD_COMMIT mismatch: expected=$expected_sha actual=${actual:-missing}"
}

build_publish() {
  local source_sha="$1" registry="$2" namespace="$3"
  validate_common "$source_sha" "$registry" "$namespace"

  local tag="sha-${source_sha:0:12}"
  local remote_image="$registry/$namespace/wotbtools-business-api:$tag"
  local local_image="wotbtools-production-business-api:$tag"
  local worktree="/tmp/wotbtools-production-build-${source_sha:0:12}-$$"
  local digest="" lookup_status=0 reused=false

  mkdir -p "$CACHE_ROOT"
  exec 8>"$BUILD_LOCK_FILE"
  flock -n 8 || die "another TX Business API build is already running"

  wait_for_gitee_sha "$source_sha"

  lookup_status=0
  digest="$(lookup_remote_digest "$remote_image")" || lookup_status=$?
  case "$lookup_status" in
    0)
      reused=true
      run_tcr_stage pull-existing \
        timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PULL_TIMEOUT_SECONDS}s" \
        docker pull "$remote_image@$digest" >/dev/null
      verify_image_commit "$remote_image@$digest" "$source_sha"
      docker tag "$remote_image@$digest" "$remote_image"
      ;;
    10)
      reused=false
      rm -rf -- "$worktree"
      git -C "$REPO_DIR" worktree add --force --detach "$worktree" "$source_sha" >/dev/null
      trap "git -C '$REPO_DIR' worktree remove --force '$worktree' >/dev/null 2>&1 || true; rm -rf -- '$worktree'" EXIT

      [ "$(git -C "$worktree" rev-parse HEAD)" = "$source_sha" ] || die "detached worktree SHA mismatch"

      timeout 1800 docker build \
        --file "$worktree/docker/Dockerfile.business-api" \
        --build-arg "BUILD_COMMIT=$source_sha" \
        --tag "$local_image" \
        "$worktree"
      verify_image_commit "$local_image" "$source_sha"

      docker tag "$local_image" "$remote_image"
      run_tcr_stage push-immutable \
        timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PUSH_TIMEOUT_SECONDS}s" docker push "$remote_image"

      digest="$(lookup_remote_digest "$remote_image")" || die "published immutable image is not readable from TCR"
      run_tcr_stage pull-published \
        timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_PULL_TIMEOUT_SECONDS}s" \
        docker pull "$remote_image@$digest" >/dev/null
      verify_image_commit "$remote_image@$digest" "$source_sha"
      ;;
    *)
      die "could not determine whether immutable TCR tag already exists"
      ;;
  esac

  printf 'RESULT source_sha=%s\n' "$source_sha"
  printf 'RESULT image=%s\n' "$remote_image"
  printf 'RESULT digest=%s\n' "$digest"
  printf 'RESULT reused=%s\n' "$reused"
  printf 'RESULT build_commit_verified=true\n'
}

usage() {
  echo "usage: $0 build-publish <source-sha> <tcr-registry> <tcr-namespace>" >&2
  exit 2
}

[ "$#" -eq 4 ] || usage
mode="$1"
shift

case "$mode" in
  build-publish) build_publish "$@" ;;
  *) usage ;;
esac
