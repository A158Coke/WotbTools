#!/usr/bin/env bash
set -euo pipefail

MAX_TRACKED_FILE_BYTES="${MAX_TRACKED_FILE_BYTES:-5242880}"
ALLOWLIST_FILE="${LARGE_FILE_ALLOWLIST_FILE:-scripts/ci/large-file-allowlist.txt}"
BASE_SHA="${BASE_SHA:-}"
HEAD_SHA="${HEAD_SHA:-HEAD}"

if ! [[ "$MAX_TRACKED_FILE_BYTES" =~ ^[0-9]+$ ]]; then
  echo "MAX_TRACKED_FILE_BYTES must be an integer, got: $MAX_TRACKED_FILE_BYTES" >&2
  exit 2
fi

is_allowlisted() {
  local candidate="$1"
  [[ -f "$ALLOWLIST_FILE" ]] || return 1

  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$candidate" == "$line" ]] && return 0
  done < "$ALLOWLIST_FILE"

  return 1
}

# Defense-in-depth for paths that must never become source even if a future
# change accidentally weakens .gitignore. The repository .gitignore remains the
# broad source of truth for generated/local-only paths.
is_forbidden_path() {
  local path="$1"
  case "$path" in
    Python/*|.deepseek/*|common/assets/wasm/*|frontend/dist/*|frontend/dist-android/*|dist/*|dist-desktop/*|target/*|*/target/*|node_modules/*|*/node_modules/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Lifecycle rule (.agents/AGENTS.md document lifecycle): Git history is the
# archive. History-parking directories are banned outright, in the tracked tree
# and in any commit tree introduced by the event range.
is_history_parking_path() {
  local path="$1"
  case "$path" in
    archive/*|*/archive/*|old/*|*/old/*|legacy-docs/*|*/legacy-docs/*|historical/*|*/historical/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Lifecycle-plan reference gate (.agents/AGENTS.md current-plan 门禁): permanent
# source/config/docs must not cite docs/current-plan.md as an authority. The
# allowlist is structural, by path role, never by content: lifecycle
# skills/playbooks, the guard workflows and the governance docs own the
# plan-carrier mechanism itself; the hygiene scripts embed the detection
# pattern; applied Flyway migrations are an explicit rule exception.
is_current_plan_allowlisted() {
  local path="$1"
  case "$path" in
    .gitignore|AGENTS.md|docs/README.md|docs/current-plan.md|scripts/ci/check-repository-hygiene.sh|scripts/ci/test-repository-hygiene.sh|.agents/*|.github/workflows/ci-gate.yml|.github/workflows/repository-hygiene-main.yml|*/db/migration/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

printable_path() {
  printf '%q' "$1"
}

report_ignored_path() {
  local scope="$1"
  local path="$2"
  echo "ERROR: path ignored by repository policy $scope: $(printable_path "$path")" >&2
  echo "       Do not force-add generated/local-only files; change .gitignore only when repository ownership intentionally changes." >&2
}

report_forbidden_path() {
  local scope="$1"
  local path="$2"
  echo "ERROR: forbidden generated/runtime path $scope: $(printable_path "$path")" >&2
}

report_history_parking_path() {
  local scope="$1"
  local path="$2"
  echo "ERROR: history-parking directory path $scope: $(printable_path "$path")" >&2
  echo "       archive/, old/, legacy-docs/ and historical/ directories are banned; Git history is the archive." >&2
}

report_current_plan_reference() {
  local path="$1"
  echo "ERROR: permanent file references the ephemeral planning artifact: $(printable_path "$path")" >&2
  echo "       docs/current-plan.md is a gitignored task carrier, not an architecture/behavior authority." >&2
  echo "       Move the statement to a canonical doc or a GitHub Issue; structural exceptions live in is_current_plan_allowlisted()." >&2
}

report_large_file() {
  local scope="$1"
  local path="$2"
  local size="$3"
  local mib limit_mib
  mib=$(awk -v bytes="$size" 'BEGIN { printf "%.2f", bytes / 1048576 }')
  limit_mib=$(awk -v bytes="$MAX_TRACKED_FILE_BYTES" 'BEGIN { printf "%.2f", bytes / 1048576 }')
  echo "ERROR: $scope exceeds ${limit_mib} MiB limit: $(printable_path "$path") (${mib} MiB)" >&2
  echo "       If this is a deliberate source-of-truth asset, add the exact path to $ALLOWLIST_FILE with PR justification." >&2
}

# Resolve the exact event range when CI did not pass one explicitly. PR runs
# use the real base/head rather than GitHub's synthetic merge ref; push runs use
# before/after so bypass pushes to main are still audited after the fact.
if [[ -z "$BASE_SHA" && -f "${GITHUB_EVENT_PATH:-}" ]]; then
  case "${GITHUB_EVENT_NAME:-}" in
    pull_request)
      mapfile -t event_range < <(
        python3 - "$GITHUB_EVENT_PATH" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    event = json.load(handle)
print(event["pull_request"]["base"]["sha"])
print(event["pull_request"]["head"]["sha"])
PY
      )
      BASE_SHA="${event_range[0]:-}"
      HEAD_SHA="${event_range[1]:-HEAD}"
      ;;
    push)
      mapfile -t event_range < <(
        python3 - "$GITHUB_EVENT_PATH" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    event = json.load(handle)
print(event.get("before", ""))
print(event.get("after", ""))
PY
      )
      if [[ "${event_range[0]:-}" != "0000000000000000000000000000000000000000" ]]; then
        BASE_SHA="${event_range[0]:-}"
        HEAD_SHA="${event_range[1]:-HEAD}"
      fi
      ;;
  esac
fi

# workflow_dispatch and local full-history runs do not necessarily have a PR
# payload. When origin/main is available, use the merge-base as the boundary.
if [[ -z "$BASE_SHA" ]] && git show-ref --verify --quiet refs/remotes/origin/main; then
  resolved_head=$(git rev-parse "$HEAD_SHA")
  BASE_SHA=$(git merge-base "$resolved_head" refs/remotes/origin/main)
  HEAD_SHA="$resolved_head"
fi

violations=0
checked=0
ignore_work=$(mktemp -d)
trap 'rm -rf "$ignore_work"' EXIT

# Ask Git itself which paths the repository ignore policy rejects. --no-index is
# required because the whole point is to catch files that were force-added even
# though .gitignore says they are local/generated. NUL input/output keeps valid
# Git pathnames with whitespace/newlines safe.
load_ignored_paths() {
  local source_kind="$1"
  local source_ref="$2"
  local destination_name="$3"
  local -n destination="$destination_name"
  local status=0

  destination=()
  if [[ "$source_kind" == "index" ]]; then
    git ls-files -z > "$ignore_work/input"
  else
    git ls-tree -r -z --name-only "$source_ref" > "$ignore_work/input"
  fi

  : > "$ignore_work/output"
  git check-ignore --no-index -z --stdin < "$ignore_work/input" > "$ignore_work/output" || status=$?
  if (( status > 1 )); then
    echo "Unable to evaluate repository .gitignore policy (git check-ignore exit $status)." >&2
    exit 2
  fi

  while IFS= read -r -d '' ignored_path; do
    destination["$ignored_path"]=1
  done < "$ignore_work/output"
}

# Guard the final tracked tree. This catches generated paths even when every
# individual file is small enough to stay below the size threshold.
declare -A tracked_ignored=()
load_ignored_paths index "" tracked_ignored

while IFS= read -r -d '' path; do
  [[ -f "$path" ]] || continue
  checked=$((checked + 1))

  if [[ -n "${tracked_ignored[$path]+x}" ]]; then
    report_ignored_path "is tracked" "$path"
    violations=$((violations + 1))
    continue
  fi

  if is_forbidden_path "$path"; then
    report_forbidden_path "is tracked" "$path"
    violations=$((violations + 1))
    continue
  fi

  if is_history_parking_path "$path"; then
    report_history_parking_path "is tracked" "$path"
    violations=$((violations + 1))
    continue
  fi

  size=$(wc -c < "$path")
  if (( size > MAX_TRACKED_FILE_BYTES )) && ! is_allowlisted "$path"; then
    report_large_file "tracked file" "$path" "$size"
    violations=$((violations + 1))
  fi
done < <(git ls-files -z)

# Inspect every tree state introduced by commits in the event range. `git ls-tree
# -z` is NUL-delimited, so valid Git paths containing newlines, tabs, quotes, or
# other unusual bytes cannot escape either the size or generated-path policy.
# This also catches a large/generated file that is committed and then deleted in
# a later commit: the violating path/blob is still present in the intermediate
# commit tree and would otherwise remain reachable from main history.
if [[ -n "$BASE_SHA" ]]; then
  git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || {
    echo "BASE_SHA is not an available commit: $BASE_SHA" >&2
    exit 2
  }
  git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null || {
    echo "HEAD_SHA is not an available commit: $HEAD_SHA" >&2
    exit 2
  }

  history_checked=0
  history_commits=0
  declare -A history_seen=()

  while IFS= read -r commit; do
    [[ -n "$commit" ]] || continue
    history_commits=$((history_commits + 1))

    declare -A commit_ignored=()
    load_ignored_paths tree "$commit" commit_ignored

    while IFS= read -r -d '' record; do
      [[ "$record" == *$'\t'* ]] || {
        echo "Unexpected git ls-tree record while checking $commit" >&2
        exit 2
      }

      meta="${record%%$'\t'*}"
      path="${record#*$'\t'}"
      read -r mode type oid size <<< "$meta"
      [[ "$type" == "blob" ]] || continue
      [[ "$size" =~ ^[0-9]+$ ]] || {
        echo "Unexpected blob size from git ls-tree for $oid" >&2
        exit 2
      }

      key="${oid}"$'\x1f'"${path}"
      [[ -n "${history_seen[$key]+x}" ]] && continue
      history_seen["$key"]=1
      history_checked=$((history_checked + 1))

      if [[ -n "${commit_ignored[$path]+x}" ]]; then
        report_ignored_path "entered Git history" "$path"
        violations=$((violations + 1))
        continue
      fi

      if is_forbidden_path "$path"; then
        report_forbidden_path "entered Git history" "$path"
        violations=$((violations + 1))
        continue
      fi

      if is_history_parking_path "$path"; then
        report_history_parking_path "entered Git history" "$path"
        violations=$((violations + 1))
        continue
      fi

      if (( size > MAX_TRACKED_FILE_BYTES )) && ! is_allowlisted "$path"; then
        report_large_file "history blob" "$path" "$size"
        violations=$((violations + 1))
      fi
    done < <(git ls-tree -r -z -l "$commit")
  done < <(git rev-list --reverse "${BASE_SHA}..${HEAD_SHA}")

  echo "Repository history hygiene checked $history_checked unique blob/path pair(s) across $history_commits commit tree(s) in ${BASE_SHA}..${HEAD_SHA}."

  # Lifecycle-plan reference gate: newly or modified permanent files in the event
  # range must not cite the ephemeral planning artifact as an authority. Legacy
  # references in untouched files stay a documented governance debt; touching the
  # file is exactly when the rule forces the migration, so the gate checks the
  # working-tree content of changed paths. Transient references that appear and
  # disappear inside the range are accepted noise — the harm is a lingering
  # reference in the final tree, not a transient one.
  mapfile -d '' changed_paths < <(git diff -z --name-only "$BASE_SHA" "$HEAD_SHA")
  plan_reference_checked=0
  plan_reference_violations=0
  for changed_path in "${changed_paths[@]}"; do
    [[ -f "$changed_path" ]] || continue
    is_current_plan_allowlisted "$changed_path" && continue
    plan_reference_checked=$((plan_reference_checked + 1))
    if grep -I -q -E 'docs/current-plan|current-plan\.md' "$changed_path"; then
      report_current_plan_reference "$changed_path"
      plan_reference_violations=$((plan_reference_violations + 1))
    fi
  done
  if (( plan_reference_violations > 0 )); then
    violations=$((violations + plan_reference_violations))
  fi
  echo "Lifecycle-plan reference gate checked $plan_reference_checked changed file(s) in ${BASE_SHA}..${HEAD_SHA}."
else
  echo "Lifecycle-plan reference gate skipped: no BASE_SHA (workflow_dispatch or local full-history run)."
fi

if (( violations > 0 )); then
  echo "Repository hygiene check failed with $violations violation(s)." >&2
  exit 1
fi

echo "Repository hygiene check passed: $checked tracked files checked; limit=$MAX_TRACKED_FILE_BYTES bytes."

# Keep the bypass scenarios executable in the same required CI path without
# recursing when the regression fixture invokes this checker in disposable repos.
if [[ "${CI:-}" == "true" && "${REPOSITORY_HYGIENE_TEST_CHILD:-0}" != "1" ]]; then
  bash scripts/ci/test-repository-hygiene.sh
fi
