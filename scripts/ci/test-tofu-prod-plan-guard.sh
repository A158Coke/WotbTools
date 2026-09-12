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

echo "COS production plan safety guard contract OK"
