#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin"
cat > "$WORK/bin/tofu" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = show ]; then
  if [ "${FAKE_TOFU_FAIL:-0}" = 1 ]; then
    echo "fixture tofu show failure" >&2
    exit 42
  fi
  cat "${FAKE_PLAN_JSON:?FAKE_PLAN_JSON is required}"
  exit 0
fi
echo "unexpected fake tofu command" >&2
exit 99
EOF
chmod +x "$WORK/bin/tofu"
: > "$WORK/plan.tfplan"

cat > "$WORK/safe.json" <<'EOF'
{"resource_changes": [{"address": "tencentcloud_cos_bucket.production_artifacts", "change": {"actions": ["no-op"]}}]}
EOF
cat > "$WORK/bucket-delete.json" <<'EOF'
{"resource_changes": [{"address": "tencentcloud_cos_bucket.production_artifacts", "change": {"actions": ["delete", "create"]}}]}
EOF
cat > "$WORK/lighthouse-delete.json" <<'EOF'
{"resource_changes": [{"address": "tencentcloud_lighthouse_instance.production", "change": {"actions": ["delete"]}}]}
EOF
cat > "$WORK/malformed.json" <<'EOF'
{"resource_changes":
EOF
cat > "$WORK/missing-resource-changes.json" <<'EOF'
{"format_version":"1.0"}
EOF
cat > "$WORK/wrong-resource-changes-type.json" <<'EOF'
{"resource_changes":{}}
EOF

PATH="$WORK/bin:$PATH" FAKE_PLAN_JSON="$WORK/safe.json" \
  bash "$ROOT/scripts/ci/validate-tofu-prod-plan.sh" "$WORK/plan.tfplan"

if PATH="$WORK/bin:$PATH" FAKE_PLAN_JSON="$WORK/bucket-delete.json" \
    bash "$ROOT/scripts/ci/validate-tofu-prod-plan.sh" "$WORK/plan.tfplan"; then
  echo "FAIL: protected COS bucket delete/replacement was accepted" >&2
  exit 1
fi

if PATH="$WORK/bin:$PATH" FAKE_PLAN_JSON="$WORK/lighthouse-delete.json" \
    bash "$ROOT/scripts/ci/validate-tofu-prod-plan.sh" "$WORK/plan.tfplan"; then
  echo "FAIL: protected Lighthouse delete was accepted" >&2
  exit 1
fi

for fixture in malformed missing-resource-changes wrong-resource-changes-type; do
  if output="$(PATH="$WORK/bin:$PATH" FAKE_PLAN_JSON="$WORK/$fixture.json" \
      bash "$ROOT/scripts/ci/validate-tofu-prod-plan.sh" "$WORK/plan.tfplan" 2>&1)"; then
    echo "FAIL: invalid plan JSON fixture was accepted: $fixture" >&2
    exit 1
  fi
  grep -Fq "plan JSON is malformed or missing resource changes" <<< "$output" || {
    echo "FAIL: invalid plan JSON fixture did not hit the fail-closed shape gate: $fixture" >&2
    printf '%s\n' "$output" >&2
    exit 1
  }
done

if output="$(PATH="$WORK/bin:$PATH" FAKE_TOFU_FAIL=1 \
    bash "$ROOT/scripts/ci/validate-tofu-prod-plan.sh" "$WORK/plan.tfplan" 2>&1)"; then
  echo "FAIL: tofu show failure was accepted" >&2
  exit 1
fi
grep -Fq "Unable to read the COS production OpenTofu plan as JSON" <<< "$output" || {
  echo "FAIL: tofu show failure did not hit the fail-closed show gate" >&2
  printf '%s\n' "$output" >&2
  exit 1
}

echo "COS production plan safety guard contract OK"
