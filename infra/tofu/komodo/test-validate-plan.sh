#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
cat > "$work/bin/tofu" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == show && "${2:-}" == -json ]] || exit 99
cat "${FAKE_PLAN_JSON:?}"
EOF
chmod +x "$work/bin/tofu"
: > "$work/plan.tfplan"

printf '%s
' '{"resource_changes":[{"address":"tencentcloud_dnspod_record.komodo","type":"tencentcloud_dnspod_record","change":{"actions":["create"]}}]}' > "$work/create.json"
printf '%s
' '{"resource_changes":[{"address":"tencentcloud_dnspod_record.komodo","type":"tencentcloud_dnspod_record","change":{"actions":["no-op"]}}]}' > "$work/noop.json"
printf '%s
' '{"resource_changes":[{"address":"tencentcloud_dnspod_record.komodo","type":"tencentcloud_dnspod_record","change":{"actions":["delete","create"]}}]}' > "$work/replace.json"
printf '%s
' '{"resource_changes":[{"address":"tencentcloud_dnspod_record.other","type":"tencentcloud_dnspod_record","change":{"actions":["create"]}}]}' > "$work/other.json"

PATH="$work/bin:$PATH" FAKE_PLAN_JSON="$work/create.json" bash "$ROOT/validate-plan.sh" "$work/plan.tfplan"
PATH="$work/bin:$PATH" FAKE_PLAN_JSON="$work/noop.json" bash "$ROOT/validate-plan.sh" "$work/plan.tfplan" --require-no-changes
for bad in replace other; do
  if PATH="$work/bin:$PATH" FAKE_PLAN_JSON="$work/$bad.json" bash "$ROOT/validate-plan.sh" "$work/plan.tfplan"; then
    echo "unsafe Komodo plan was accepted: $bad" >&2
    exit 1
  fi
done
if PATH="$work/bin:$PATH" FAKE_PLAN_JSON="$work/create.json" bash "$ROOT/validate-plan.sh" "$work/plan.tfplan" --require-no-changes; then
  echo 'dirty Komodo second plan was accepted' >&2
  exit 1
fi

echo 'Komodo plan guard fixtures: PASS'
