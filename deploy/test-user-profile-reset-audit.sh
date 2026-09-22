#!/usr/bin/env bash
# Static safety gate: the profile-reset audit is evidence-only and must never
# become an executable data mutation without a separately approved change.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUDIT="$ROOT/deploy/sql/user-profile-reset-audit.sql"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -f "$AUDIT" ] || fail "missing user_profile reset audit"

# Strip SQL line comments first: the contract is documented in comments, but
# only executable SQL must be mutation-free.
executable_sql="$(sed -E 's/--.*$//' "$AUDIT")"
if grep -Eiq '\b(delete|update|truncate|alter|drop|create|insert|merge|grant|revoke|cascade)\b' <<< "$executable_sql"; then
  fail "user_profile reset audit must remain read-only"
fi

for required in \
  'pg_constraint' \
  'information_schema.columns' \
  'hundred_battle_submission' \
  'mark3_submission'; do
  grep -Fq "$required" "$AUDIT" || fail "audit is missing required dependency evidence: $required"
done

echo "OK: user_profile reset audit is read-only and covers declared/business ownership dependencies"
