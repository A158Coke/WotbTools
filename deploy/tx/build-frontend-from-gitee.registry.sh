#!/usr/bin/env bash
# Registry identity and retry handling shared by the frontend build driver.
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

