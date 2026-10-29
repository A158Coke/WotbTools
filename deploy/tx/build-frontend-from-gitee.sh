#!/usr/bin/env bash
# Build and publish the Frontend on the TX2 build host from an exact commit. GitHub
# remains the release authority; Gitee is the domestic source transport and is tried
# first. When the mirror cannot serve the commit yet, the exact SHA is fetched shallow
# from GitHub instead (about 53MB vs the ~300MB full history a post-rewrite mirror push needs),
# so a lagging mirror never blocks a release. The pinned Agent WASM release archive is
# staged by GitHub because it is tiny; the expensive frontend image build and TCR
# publication stay entirely in China.
#
# 2026-10-26 placement: the Frontend image builds on TX2, not TX1. TX1 has 1.9 GiB RAM
# and runs the production containers; after #753 (Reka/VueUse/motion-v) the build needs
# ~1.05 GiB of V8 old space and a 1152 MiB heap trial left TX1 at 174 MiB available /
# 229 MiB free swap. TX2 has 3.6 GiB (2.9 GiB available) and completed the same build
# with no swap use. TX1 still owns deployment and pulls the immutable TCR artifact.
set -Eeuo pipefail

readonly GITEE_REPO_URL="${WOTB_GITEE_REPO_URL:-https://gitee.com/A158Coke/Wotbtools.git}"
# 镜像落后时的兜底：GitHub 允许按 exact SHA 浅取（53MB，实测 18s），只取该 commit 的树，
# 不需要任何历史。它比"把重写后的全新 commit 图整推 Gitee"（约 300MB）小一个数量级，
# 所以镜像 budget 再大也不该成为发布的前置条件。
readonly GITHUB_REPO_URL="${WOTB_GITHUB_REPO_URL:-https://github.com/A158Coke/WotbTools.git}"
# Cache/lock 属于**构建宿主**：Frontend 在 TX2 构建，Business API 仍在 TX1 构建，
# 两侧缓存与 build.lock 刻意分离（同一 commit 同时改两个应用时不再争用 TX1 的
# CPU/RAM，也不会共享一份 Gitee clone）。
readonly CACHE_ROOT="${WOTB_TX_BUILD_CACHE_ROOT:-$HOME/.cache/wotbtools-production-build}"
readonly REPO_DIR="$CACHE_ROOT/repo"
# 浅取仓库是每次构建的临时源（不复用：浅边界不适合长期 cache）。
readonly SHALLOW_SOURCE_DIR="$CACHE_ROOT/source-shallow"
# 当前构建的源仓库：镜像命中时为持久的 Gitee clone，兜底时为浅取仓库。所有
# `git show <sha>:<path>` / commit epoch 读取都从它出发，两条路径语义一致。
SOURCE_DIR="$REPO_DIR"
readonly BUILD_LOCK_FILE="$CACHE_ROOT/build.lock"
# TX2 build 与同一宿主上的 Production Worker / Frontend replica 共用既有主机维护锁；
# 空值 = 不获取（单测与 TX1 调试路径）。workflow 显式传 /opt/wotb-tx2/.deploy.lock。
readonly HOST_LOCK_FILE="${WOTB_BUILD_HOST_LOCK:-}"
readonly HOST_LOCK_WAIT_SECONDS="${HOST_LOCK_WAIT_SECONDS:-600}"
readonly GITEE_WAIT_ATTEMPTS="${GITEE_WAIT_ATTEMPTS:-12}"
readonly GITEE_WAIT_INTERVAL_SECONDS="${GITEE_WAIT_INTERVAL_SECONDS:-15}"
readonly GIT_FETCH_TIMEOUT_SECONDS="${GIT_FETCH_TIMEOUT_SECONDS:-60}"
# 53MB 跨境浅取的预算：够慢链路走完，又不至于让一次失败拖满 90 分钟的 build job。
readonly GITHUB_FETCH_TIMEOUT_SECONDS="${GITHUB_FETCH_TIMEOUT_SECONDS:-900}"
readonly GITHUB_FETCH_ATTEMPTS="${GITHUB_FETCH_ATTEMPTS:-3}"
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

# 构建身份的确定性（见 docs/android/release-process.md「构建身份的确定性」）：源 commit 的
# unix 时间戳。生产镜像由本脚本构建，而 Docker 上下文没有 .git，必须在这里显式注入
# SOURCE_DATE_EPOCH；否则 version.json / `__BUILD_TIME__` 回落 wall-clock，同一 source_sha
# 重跑会产出不同字节的镜像，撞 immutable tag/evidence 纪律。$1 = 含该 commit 的 git 目录，
# $2 = 完整 SHA。
source_commit_epoch() {
  local git_dir="$1" sha="$2" epoch
  epoch="$(git -C "$git_dir" show -s --format=%ct "$sha" 2>/dev/null)" \
    || die "cannot resolve commit epoch for $sha"
  case "$epoch" in ''|*[!0-9]*) die "invalid commit epoch for $sha: $epoch" ;; esac
  printf '%s' "$epoch"
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
    GITHUB_FETCH_TIMEOUT_SECONDS GITHUB_FETCH_ATTEMPTS \
    TCR_PUSH_TIMEOUT_SECONDS TCR_LOOKUP_TIMEOUT_SECONDS TCR_PULL_TIMEOUT_SECONDS KILL_AFTER_SECONDS \
    RETRY_MAX_ATTEMPTS RETRY_BACKOFF_FIRST_SECONDS RETRY_BACKOFF_LATER_SECONDS HOST_LOCK_WAIT_SECONDS; do
    is_positive_integer "${!setting}" || die "$setting must be a positive integer"
  done
  [ "$RETRY_MAX_ATTEMPTS" -le 3 ] || die "RETRY_MAX_ATTEMPTS cannot exceed 3"

  for command_name in git docker timeout flock python3 sha256sum grep; do
    command -v "$command_name" >/dev/null || die "$command_name is required"
  done
  docker version >/dev/null
  # buildx 不是每个构建宿主的发行版 Docker 都带（TX2 的 Ubuntu 包就没有）。构建本身
  # 走 `docker build`；只有远端 immutable digest 查询需要 buildx，缺失时回退到
  # `docker manifest inspect --verbose`（见 docker_image_digest）。
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

  echo "gitee_sync result=LAG source_sha=$source_sha attempts=$GITEE_WAIT_ATTEMPTS"
  return 1
}

# 按 exact SHA 从 GitHub 浅取（只含该 commit 的树）。GitHub 允许 fetch 未在 ref 里
# 通告的 SHA；取到的对象与镜像路径完全同构，因此 epoch/source.json/worktree 读取
# 不需要任何特判。每次重建目录：浅边界不该被复用。
fetch_exact_sha_shallow() {
  local source_sha="$1"
  local attempt

  mkdir -p "$CACHE_ROOT"
  for attempt in $(seq 1 "$GITHUB_FETCH_ATTEMPTS"); do
    rm -rf -- "$SHALLOW_SOURCE_DIR"
    mkdir -p "$SHALLOW_SOURCE_DIR"
    git -C "$SHALLOW_SOURCE_DIR" init -q
    echo "github_exact_fetch attempt=$attempt/$GITHUB_FETCH_ATTEMPTS source_sha=$source_sha"
    if timeout --kill-after="${KILL_AFTER_SECONDS}s" "$GITHUB_FETCH_TIMEOUT_SECONDS" \
      env GIT_TERMINAL_PROMPT=0 \
      git -C "$SHALLOW_SOURCE_DIR" fetch --depth 1 --no-tags "$GITHUB_REPO_URL" "$source_sha"; then
      if [ "$(git -C "$SHALLOW_SOURCE_DIR" rev-parse FETCH_HEAD 2>/dev/null)" = "$source_sha" ] \
        && git -C "$SHALLOW_SOURCE_DIR" cat-file -e "$source_sha^{commit}" 2>/dev/null; then
        echo "github_exact_fetch result=PASS source_sha=$source_sha"
        return 0
      fi
      echo "github_exact_fetch result=SHA_MISMATCH source_sha=$source_sha" >&2
    fi
    if [ "$attempt" -lt "$GITHUB_FETCH_ATTEMPTS" ]; then
      sleep "$RETRY_BACKOFF_LATER_SECONDS"
    fi
  done
  rm -rf -- "$SHALLOW_SOURCE_DIR"
  return 1
}

# 源物化：国内镜像优先（稳定态只取增量），镜像追不上时按 exact SHA 直取 GitHub，
# 两者都失败才 fail closed。每条路径都把 SOURCE_DIR 指向"含该 commit 的仓库"，
# 并把实际使用的传输写进日志（发布证据里能区分 mirror 命中与兜底）。
materialize_source() {
  local source_sha="$1"

  if wait_for_gitee_sha "$source_sha"; then
    SOURCE_DIR="$REPO_DIR"
    echo "source_transport=gitee-mirror"
    return 0
  fi

  echo "source_transport=gitee-lagging; exact-SHA fallback engaged"
  fetch_exact_sha_shallow "$source_sha" \
    || die "source SHA is neither on Gitee main nor fetchable from GitHub as an exact SHA"
  SOURCE_DIR="$SHALLOW_SOURCE_DIR"
  echo "source_transport=github-exact-sha"
}

docker_image_digest() {
  local image="$1" raw err status
  # TX1 有 buildx：imagetools 直接返回 index/manifest 的顶层 digest。TX2 的发行版
  # Docker 没有 buildx 插件：`docker manifest inspect --verbose` 给出该 tag 的
  # per-platform Descriptor；单架构镜像用它 pull 同样可验证。部署侧的 canonical
  # digest 由 runner 重新解析，不使用这里的输出作为部署身份。
  # timeout 必须包住具体命令而不是本函数：shell 函数不能直接作为 timeout 的 child。
  if docker buildx version >/dev/null 2>&1; then
    timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_LOOKUP_TIMEOUT_SECONDS}s" \
      docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$image"
    return
  fi
  raw="$(mktemp)"
  err="$(mktemp)"
  # 先单独捕获 manifest 命令的原退出码：timeout 的 124 必须原样上抛给
  # lookup_remote_digest 的有界重试。若把命令与 Python 解析放进同一条 pipefail
  # 管道，空输出会让 Python 以 1 退出并覆盖 124，第一次超时就永久中止发布。
  if timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_LOOKUP_TIMEOUT_SECONDS}s" \
    docker manifest inspect --verbose "$image" >"$raw" 2>"$err"; then
    python3 - "$raw" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
entry = data[0] if isinstance(data, list) and data else data
digest = (entry or {}).get("Descriptor", {}).get("digest", "")
if not digest:
    raise SystemExit("manifest has no Descriptor.digest")
print(digest)
PY
    status=$?
  else
    status=$?
    cat "$err" >&2
  fi
  rm -f "$raw" "$err"
  return "$status"
}

lookup_remote_digest() {
  local image="$1"
  local attempt=1 output_file output status digest backoff

  while :; do
    output_file="$(mktemp)"
    if digest="$(docker_image_digest "$image" 2>"$output_file")"; then
      rm -f "$output_file"
      [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die "registry returned an invalid digest for $image"
      printf '%s\n' "$digest"
      return 0
    else
      status=$?
    fi
    output="$(<"$output_file")"
    rm -f "$output_file"

    # `docker manifest inspect` 在 TX2 上对缺失 tag 报 "no such manifest"；
    # buildx imagetools 报 "manifest unknown"/"not found"。两者都必须按
    # 「tag 尚未发布」返回 10，触发构建，而不是当成致命错误。
    if grep -Eqi '(no such manifest|manifest unknown|name unknown|not found|404)' <<<"$output"; then
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
  read -r agent_ref agent_release < <(git -C "$SOURCE_DIR" show "$source_sha:deploy/agent/source.json" \
    | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data.get("ref", ""), (data.get("artifact") or {}).get("release", ""))
')
  [[ "$agent_ref" =~ ^[0-9a-f]{40}$ ]] || die "source.json at $source_sha has no valid ref"
  [ -n "$agent_release" ] || die "source.json at $source_sha has no artifact.release"

  # 镜像内 version.json 的 buildTime 必须等于源 commit 时间（= 构建时注入的 SOURCE_DATE_EPOCH）。
  # 这条把"确定性构建身份"从脚本传参升级为**产物级断言**：wall-clock 回落、参数丢失、或有人
  # 改回 new Date() 都会在这里被拦住（Docker 上下文无 .git，时间只能由本脚本给）。
  local source_epoch expected_build_time
  source_epoch="$(source_commit_epoch "$SOURCE_DIR" "$source_sha")"
  expected_build_time="$(SOURCE_EPOCH="$source_epoch" python3 -c '
import datetime, os
epoch = int(os.environ["SOURCE_EPOCH"])
print(datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"))
')"
  [ -n "$expected_build_time" ] || die "cannot derive expected buildTime for $source_sha"

  container="$(docker create "$image")" || die "cannot create verification container from $image"
  temp="$(mktemp -d)"

  if ! (
    set -Eeuo pipefail
    docker cp "$container:/usr/share/nginx/html" "$temp/html"
    grep -Fq "\"buildCommit\": \"$source_sha\"" "$temp/html/version.json"
    grep -Fq "\"buildTime\": \"$expected_build_time\"" "$temp/html/version.json"
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

  local identity tag remote_image local_image worktree digest lookup_status reused sponsor_tmp="" source_epoch=""
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
  # 主机维护锁在 cache lock 之后获取：两个 build 先串行，再与 Production Worker /
  # Frontend replica 的 /opt/wotb-tx2/.deploy.lock 互斥。先 host 后 cache 会让
  # build A 持 host 等 cache、build B 持 cache 等 host 形成死锁。
  if [ -n "$HOST_LOCK_FILE" ]; then
    [ -e "$HOST_LOCK_FILE" ] || die "host maintenance lock is missing: $HOST_LOCK_FILE"
    exec 7>"$HOST_LOCK_FILE"
    flock -w "$HOST_LOCK_WAIT_SECONDS" 7 \
      || die "timed out waiting for host maintenance lock: $HOST_LOCK_FILE"
  fi

  if [ -n "$sponsor_fingerprint" ]; then
    sponsor_tmp="$(mktemp -d)"
  fi
  cleanup_build_leftovers() {
    local worktree="$1" sponsor_tmp="$2"
    git -C "$SOURCE_DIR" worktree remove --force "$worktree" >/dev/null 2>&1 || true
    rm -rf -- "$worktree"
    [ -z "$sponsor_tmp" ] || rm -rf -- "$sponsor_tmp"
    rm -rf -- "$SHALLOW_SOURCE_DIR"
  }
  # Capture quoted paths now: EXIT runs after build_publish's locals leave scope.
  trap "$(printf 'cleanup_build_leftovers %q %q' "$worktree" "$sponsor_tmp")" EXIT

  if [ -n "$sponsor_fingerprint" ]; then
    unpack_sponsor_bundle "$sponsor_bundle" "$sponsor_tmp"
  fi

  materialize_source "$source_sha"

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
      git -C "$SOURCE_DIR" worktree add --force --detach "$worktree" "$source_sha" >/dev/null

      [ "$(git -C "$worktree" rev-parse HEAD)" = "$source_sha" ] || die "detached worktree SHA mismatch"
      verify_agent_archive "$worktree" "$agent_archive"
      WOTB_AGENT_ARTIFACT_FILE="$agent_archive" bash "$worktree/scripts/fetch-agent-wasm.sh"
      if [ -n "$sponsor_tmp" ]; then
        # publicDir（common/assets/）——Vite 原样拷进 dist，随镜像进 nginx root。
        mkdir -p "$worktree/common/assets"
        cp -R "$sponsor_tmp/." "$worktree/common/assets/"
      fi

      source_epoch="$(source_commit_epoch "$SOURCE_DIR" "$source_sha")"
      timeout 1800 docker build \
        --file "$worktree/docker/Dockerfile.frontend" \
        --build-arg "BUILD_COMMIT=$source_sha" \
        --build-arg "SOURCE_DATE_EPOCH=$source_epoch" \
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
