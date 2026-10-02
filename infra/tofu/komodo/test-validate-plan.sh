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

# The exact intended record. The guard locks all eight fields, so each fixture
# below differs from this one in exactly one of them.
after_ok='{"domain":"wotbtools.com","sub_domain":"komodo","record_type":"A","record_line":"默认","value":"118.25.18.105","ttl":600,"status":"ENABLE","remark":"WotBTools Komodo controller ingress"}'
after_string_ttl='{"domain":"wotbtools.com","sub_domain":"komodo","record_type":"A","record_line":"默认","value":"118.25.18.105","ttl":"600","status":"ENABLE","remark":"WotBTools Komodo controller ingress"}'
after_wrong_domain='{"domain":"example.com","sub_domain":"komodo","record_type":"A","record_line":"默认","value":"118.25.18.105","ttl":600,"status":"ENABLE","remark":"WotBTools Komodo controller ingress"}'
after_wrong_subdomain='{"domain":"wotbtools.com","sub_domain":"komodo-controller","record_type":"A","record_line":"默认","value":"118.25.18.105","ttl":600,"status":"ENABLE","remark":"WotBTools Komodo controller ingress"}'
after_wrong_record_type='{"domain":"wotbtools.com","sub_domain":"komodo","record_type":"AAAA","record_line":"默认","value":"118.25.18.105","ttl":600,"status":"ENABLE","remark":"WotBTools Komodo controller ingress"}'
after_wrong_record_line='{"domain":"wotbtools.com","sub_domain":"komodo","record_type":"A","record_line":"其他","value":"118.25.18.105","ttl":600,"status":"ENABLE","remark":"WotBTools Komodo controller ingress"}'
after_wrong_value='{"domain":"wotbtools.com","sub_domain":"komodo","record_type":"A","record_line":"默认","value":"203.0.113.7","ttl":600,"status":"ENABLE","remark":"WotBTools Komodo controller ingress"}'
after_wrong_ttl='{"domain":"wotbtools.com","sub_domain":"komodo","record_type":"A","record_line":"默认","value":"118.25.18.105","ttl":60,"status":"ENABLE","remark":"WotBTools Komodo controller ingress"}'
after_wrong_status='{"domain":"wotbtools.com","sub_domain":"komodo","record_type":"A","record_line":"默认","value":"118.25.18.105","ttl":600,"status":"DISABLE","remark":"WotBTools Komodo controller ingress"}'
after_wrong_remark='{"domain":"wotbtools.com","sub_domain":"komodo","record_type":"A","record_line":"默认","value":"118.25.18.105","ttl":600,"status":"ENABLE","remark":"something else"}'

# record <address> <type> <actions-json> <after-json> -> one resource change
record() {
  printf '{"address":"%s","type":"%s","change":{"actions":%s,"after":%s}}' "$1" "$2" "$3" "$4"
}

# plan <records-json> <fixture-name> -> a complete saved-plan document
plan() {
  printf '{"resource_changes":[%s]}\n' "$1" > "$work/$2.json"
}

# plan_create <fixture-name> <after-json> -> a create of the Komodo record
plan_create() {
  plan "$(record "$komodo_address" "$dnspod_type" '["create"]' "$2")" "$1"
}

# plan_action <fixture-name> <after-json> <actions-json> -> a full plan document
plan_action() {
  plan "$(record "$komodo_address" "$dnspod_type" "$3" "$2")" "$1"
}

plan_create create "$after_ok"
plan_action noop "$after_ok" '["no-op"]'
plan_action update "$after_ok" '["update"]'
# The provider may encode `ttl` as a JSON string; the guard accepts 600 either way.
plan_create string-ttl "$after_string_ttl"

plan_action replace "$after_ok" '["delete","create"]'
plan "$(record "$komodo_address" "$dnspod_type" '["delete"]' 'null')" delete
plan "$(record tencentcloud_dnspod_record.other "$dnspod_type" '["create"]' "$after_ok")" other-address
plan "$(record "$komodo_address" tencentcloud_other_resource '["create"]' "$after_ok")" other-type

plan_create wrong-domain "$after_wrong_domain"
plan_create wrong-subdomain "$after_wrong_subdomain"
plan_create wrong-record-type "$after_wrong_record_type"
plan_create wrong-record-line "$after_wrong_record_line"
plan_create wrong-value "$after_wrong_value"
plan_create wrong-ttl "$after_wrong_ttl"
plan_create wrong-status "$after_wrong_status"
plan_create wrong-remark "$after_wrong_remark"

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
accepts string-ttl
accepts empty
accepts noop --require-no-changes
accepts empty --require-no-changes

for fixture in replace delete other-address other-type two-resources \
  wrong-domain wrong-subdomain wrong-record-type wrong-record-line \
  wrong-value wrong-ttl wrong-status wrong-remark; do
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
