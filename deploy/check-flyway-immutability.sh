#!/usr/bin/env bash
set -euo pipefail

readonly MIGRATION_DIR="java/wotb-web/src/main/resources/db/migration"
readonly V18_PATH="$MIGRATION_DIR/V18__create_hundred_battle_submission.sql"
readonly V18_DRIFTED_BLOB="212635ebf5c04198476af52f4913dbfd2a9f0e4e"
readonly V18_HISTORICAL_BLOB="a7941f0d2e4c545043e7b38f40c8e0cd0837ba6b"
readonly BASE_REF="${1:-${BASE_REF:-origin/main}}"

if ! git rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  echo "ERROR: Flyway immutability guard cannot resolve base commit: ${BASE_REF}" >&2
  exit 2
fi

base_max_version="$({
  git ls-tree -r --name-only "$BASE_REF" -- "$MIGRATION_DIR" \
    | awk -F/ '/\/V[0-9]+__[^/]+\.sql$/ {
        name = $NF
        sub(/^V/, "", name)
        sub(/__.*/, "", name)
        if ((name + 0) > max) max = name + 0
      }
      END { print max + 0 }'
} )"

fail_immutable() {
  echo "ERROR: Existing Flyway versioned migrations are immutable." >&2
  echo "Do not modify, rename, delete, reformat, or update comments in an existing V*.sql file." >&2
  echo "If the database schema must change, create a new forward-only migration." >&2
  exit 1
}

fail_added() {
  echo "ERROR: New Flyway versioned migration is invalid: $1" >&2
  exit 1
}

changed=0
while IFS=$'\t' read -r status path _; do
  [ -n "${status:-}" ] || continue
  changed=1
  case "$status" in
    A)
      file_name="${path##*/}"
      if [[ ! "$file_name" =~ ^V([0-9]+)__[^/]+\.sql$ ]]; then
        fail_added "$path (must use V<N>__name.sql)"
      fi
      version="${BASH_REMATCH[1]}"
      if (( version <= base_max_version )); then
        fail_added "$path (version ${version} must be greater than base maximum ${base_max_version})"
      fi
      echo "OK: new Flyway migration ${path} (version ${version})"
      ;;
    M)
      if [ "$path" = "$V18_PATH" ] \
          && [ "$(git rev-parse "${BASE_REF}:${path}")" = "$V18_DRIFTED_BLOB" ] \
          && [ "$(git rev-parse "HEAD:${path}")" = "$V18_HISTORICAL_BLOB" ]; then
        echo "OK: V18 restored to its authoritative historical blob (one-time exception)."
      else
        fail_immutable
      fi
      ;;
    D|R*|C*|T|U)
      fail_immutable
      ;;
    *)
      fail_immutable
      ;;
  esac
done < <(git diff --name-status --find-renames "$BASE_REF" HEAD -- "$MIGRATION_DIR")

if [ "$changed" -eq 0 ]; then
  echo "OK: no Flyway versioned migration changes detected."
fi
