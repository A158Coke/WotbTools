#!/usr/bin/env bash
# Local fixtures for the Komodo plan guard. No backend, no cloud credentials, and
# no network access: `tofu` is replaced by a stub that echoes a saved plan JSON.
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

komodo_address=tencentcloud_dnspod_record.komodo
dnspod_type=tencentcloud_dnspod_record
after_ok='{"domain":"wotbtools.com","sub_domain":"komodo","record_type":"A","value":"118.25.18.105","status":"ENABLE"}'

# record <address> <type> <actions-json> <after-json> -> one resource change
record() {
  printf '{"address":"%s","type":"%s","change":{"actions":%s,"after":%s}}' "$1" "$2" "$3" "$4"
}

# plan <records-json> -> a complete saved-plan document
plan() {
  printf '{"resource_changes":[%s]}\n' "$1" > "$work/$2.json"
}

plan "$(record "$komodo_address" "$dnspod_type" '["create"]' "$after_ok")" create
plan "$(record "$komodo_address" "$dnspod_type" '["no-op"]' "$after_ok")" noop
plan "$(record "$komodo_address" "$dnspod_type" '["update"]' "$after_ok")" update

plan "$(record "$komodo_address" "$dnspod_type" '["delete","create"]' "$after_ok")" replace
plan "$(record "$komodo_address" "$dnspod_type" '["delete"]' 'null')" delete
plan "$(record tencentcloud_dnspod_record.other "$dnspod_type" '["create"]' "$after_ok")" other-address
plan "$(record "$komodo_address" tencentcloud_other_resource '["create"]' "$after_ok")" other-type
plan "$(record "$komodo_address" "$dnspod_type" '["create"]' \
  '{"domain":"wotbtools.com","sub_domain":"komodo","record_type":"A","value":"203.0.113.7","status":"ENABLE"}')" wrong-value
plan "$(record "$komodo_address" "$dnspod_type" '["create"]' \
  '{"domain":"wotbtools.com","sub_domain":"komodo-controller","record_type":"A","value":"118.25.18.105","status":"ENABLE"}')" wrong-subdomain
plan "$(record "$komodo_address" "$dnspod_type" '["create"]' "$after_ok"),$(record "$komodo_address" "$dnspod_type" '["create"]' "$after_ok")" two-resources
printf '%s\n' '{"resource_changes":[]}' > "$work/empty.json"

guard() {
  local fixture="$1"
  shift
  PATH="$work/bin:$PATH" FAKE_PLAN_JSON="$work/$fixture.json" bash "$ROOT/validate-plan.sh" "$work/plan.tfplan" "$@"
}

accepts() {
  local fixture="$1"
  shift
  guard "$fixture" "$@" >/dev/null || {
    echo "safe Komodo plan was rejected: $fixture $*" >&2
    exit 1
  }
}

rejects() {
  local fixture="$1"
  shift
  if guard "$fixture" "$@" >/dev/null 2>&1; then
    echo "unsafe Komodo plan was accepted: $fixture $*" >&2
    exit 1
  fi
}

accepts create
accepts noop
accepts update
accepts empty
accepts noop --require-no-changes
accepts empty --require-no-changes

for fixture in replace delete other-address other-type wrong-value wrong-subdomain two-resources; do
  rejects "$fixture"
done
rejects create --require-no-changes
rejects update --require-no-changes

# The guard also refuses an unknown mode and a missing plan file.
if bash "$ROOT/validate-plan.sh" "$work/plan.tfplan" --unknown-mode >/dev/null 2>&1; then
  echo 'an unknown Komodo plan-guard mode was accepted' >&2
  exit 1
fi
if bash "$ROOT/validate-plan.sh" "$work/absent.tfplan" >/dev/null 2>&1; then
  echo 'a missing Komodo plan file was accepted' >&2
  exit 1
fi

echo 'Komodo plan guard fixtures: PASS'
