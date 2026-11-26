#!/usr/bin/env bash
docker_image_digest() {
  local image="$1" raw err status
  if docker buildx version >/dev/null 2>&1; then
    timeout --kill-after="${KILL_AFTER_SECONDS}s" "${TCR_LOOKUP_TIMEOUT_SECONDS}s" \
      docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$image"
    return
  fi
  raw="$(mktemp)"
  err="$(mktemp)"
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

