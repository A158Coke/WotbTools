#!/usr/bin/env bash

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

  # History-gate allowlist: the union of entries at BASE_SHA and HEAD, parsed in
  # this shell (a pipeline would discard assoc-array writes to a subshell). An
  # entry that existed at the base covers the normal split flow; an entry that
  # survives to HEAD covers a rename swap; an entry that exists at neither
  # endpoint shields nothing, so a temporary exemption cannot admit an
  # oversized blob that is later shrunk or deleted.
  declare -A source_line_history_allowlisted=()
  if git cat-file -e "${BASE_SHA}:${SOURCE_LINE_ALLOWLIST_FILE}" 2>/dev/null; then
    git show "${BASE_SHA}:${SOURCE_LINE_ALLOWLIST_FILE}" > "$ignore_work/base-source-line-allowlist" || {
      echo "ERROR: unable to read ${SOURCE_LINE_ALLOWLIST_FILE} at ${BASE_SHA}." >&2
      exit 2
    }
    load_source_line_paths source_line_history_allowlisted < "$ignore_work/base-source-line-allowlist"
  fi
  # The HEAD side of the union reuses the final-tree parse result: running the
  # duplicate detector across the two sources would flag a base entry that
  # legitimately survives to HEAD as a duplicate.
  for union_path in "${!source_line_head_entries[@]}"; do
    source_line_history_allowlisted["$union_path"]=1
  done

  # A branch forked before main split a legacy file may still carry its old
  # over-budget blob in earlier commit trees. The fork point is trusted because
  # merge-base(commit, BASE) is reachable from current main, unlike branch-only
  # changes. A blob unchanged since that fork is grandfathered even without an
  # explicit allowlist entry; a changed or newly added blob is NOT.
  # Preserve the existing explicit fork-point allowlist rule for pre-existing
  # approved exceptions (including allowed edits to those exception paths).
  declare -A fork_allowlist_loaded=()
  declare -A fork_allowlisted=()
  fork_point_permits_source_blob() {
    local commit="$1" path="$2" oid="$3" fork fork_oid
    fork=$(git merge-base "$commit" "$BASE_SHA" 2>/dev/null) || return 1
    [[ -n "$fork" ]] || return 1
    fork_oid=$(git rev-parse --verify "${fork}:${path}" 2>/dev/null) || fork_oid=""
    if [[ -n "$fork_oid" && "$fork_oid" == "$oid" ]]; then
      return 0
    fi
    if [[ -z "${fork_allowlist_loaded[$fork]+x}" ]]; then
      fork_allowlist_loaded["$fork"]=1
      if git cat-file -e "${fork}:${SOURCE_LINE_ALLOWLIST_FILE}" 2>/dev/null; then
        declare -A fork_entries=()
        load_source_line_paths fork_entries < <(git show "${fork}:${SOURCE_LINE_ALLOWLIST_FILE}")
        local entry
        for entry in "${!fork_entries[@]}"; do fork_allowlisted["${fork}:${entry}"]=1; done
        unset fork_entries
      fi
    fi
    [[ -n "${fork_allowlisted["${fork}:${path}"]+x}" ]]
  }

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

      if is_source_line_candidate "$path"; then
        blob_lines=$(git cat-file blob "$oid" | awk 'END { print NR }')
        if ! [[ "$blob_lines" =~ ^(0|[1-9][0-9]*)$ ]] || (( ${#blob_lines} > 18 )); then
          echo "Unable to count source lines of blob $oid for $(printable_path "$path") (awk returned: ${blob_lines:-<empty>})." >&2
          exit 2
        fi
        if (( blob_lines > MAX_SOURCE_LINES )) && [[ -z "${source_line_history_allowlisted[$path]+x}" ]] && ! is_unmodified_base_source_blob "$path" "$oid" && ! fork_point_permits_source_blob "$commit" "$path" "$oid"; then
          # The union list only decides whether the over-budget blob was ever a
          # sanctioned exception; policing per-file net growth is left to the
          # split workflow (the entry-count ratchet owns the allowlist).
          report_source_line_budget "$path" "$blob_lines"
          violations=$((violations + 1))
        fi
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
    # `--` keeps filenames that parse as options (e.g. a root-level `-notes.md`)
    # from being eaten as grep flags; exit 1 is "no match", but any other status
    # is a tool failure and must fail closed instead of reading as a clean file.
    grep_status=0
    grep -I -q -E 'docs/current-plan|current-plan\.md' -- "$changed_path" || grep_status=$?
    if (( grep_status > 1 )); then
      echo "ERROR: reference gate grep failed on $changed_path (exit $grep_status)." >&2
      exit 2
    fi
    if (( grep_status == 0 )); then
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
