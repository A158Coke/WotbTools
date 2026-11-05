#!/usr/bin/env bash
# Shared publish protocol for the three data-update workflows
# (update-tankopedia.yml / update-equipment.yml / update-crew-skills.yml).
#
# Restricted helper: it only implements the pre-existing per-workflow publish
# block — unchanged exit -> staged-content guard -> bot identity -> branch
# handling -> whitelist commit -> push -> find/create PR -> verify PR identity
# -> exact-HEAD dispatch. It is not a general release platform: only the three
# automation/update-* target branches are accepted, only the caller-supplied
# pathspecs are committed (never `git add -A` / `git add .`), and no command is
# ever built by string interpolation into a shell evaluation.
set -euo pipefail

usage() {
  echo "usage: $0 --branch <automation/update-*> [--source-ref <ref>] \\" >&2
  echo "          --commit-message <msg> --pr-title <title> --pr-body-file <file> \\" >&2
  echo "          --path <pathspec> [--path <pathspec>...]" >&2
  exit 2
}

BRANCH=""
SOURCE_REF=""
COMMIT_MESSAGE=""
PR_TITLE=""
PR_BODY_FILE=""
PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="${2-}"; shift 2 ;;
    --source-ref) SOURCE_REF="${2-}"; shift 2 ;;
    --commit-message) COMMIT_MESSAGE="${2-}"; shift 2 ;;
    --pr-title) PR_TITLE="${2-}"; shift 2 ;;
    --pr-body-file) PR_BODY_FILE="${2-}"; shift 2 ;;
    --path) PATHS+=("${2-}"); shift 2 ;;
    *) usage ;;
  esac
done

case "$BRANCH" in
  automation/update-tankopedia | automation/update-equipment | automation/update-crew-skills) ;;
  *)
    echo "::error::publish-data-update.sh only serves the three data-update automation branches, got: $BRANCH" >&2
    exit 2
    ;;
esac

[[ -n "$COMMIT_MESSAGE" && -n "$PR_TITLE" && -n "$PR_BODY_FILE" ]] || usage
[[ ${#PATHS[@]} -gt 0 ]] || usage
[[ -f "$PR_BODY_FILE" ]] || { echo "::error::PR body file not found: $PR_BODY_FILE" >&2; exit 2; }

# Unexpected staged content must never be swept into a bot commit.
staged="$(git diff --cached --name-only)"
if [[ -n "$staged" ]]; then
  echo "::error::Unexpected staged content before publish; refusing to commit:" >&2
  printf '%s\n' "$staged" >&2
  exit 1
fi

# No changes: no branch switch, no commit, no push, no PR, no dispatch.
if git diff --quiet -- "${PATHS[@]}"; then
  echo "No changes in the whitelisted paths; nothing to publish."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  git switch -C "$BRANCH"
fi

git add -- "${PATHS[@]}"
git commit -m "$COMMIT_MESSAGE"

# Same-source runs (Tankopedia dispatching on its own automation branch) keep
# the plain fast-forward push; every other branch rebuild is force-with-lease.
if [[ -n "$SOURCE_REF" && "$SOURCE_REF" == "$BRANCH" ]]; then
  git push origin "HEAD:$BRANCH"
else
  git push --force-with-lease origin "HEAD:$BRANCH"
fi

# JSON parsing only: python reads the gh output and prints a number / verdict.
# It never interprets the JSON as commands.
pr_list="$(gh pr list --base main --head "$BRANCH" --state open --json number --jq '.[0].number // empty')"
pr_number="$(printf '%s' "$pr_list" | python3 -c 'import json,sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        value = data[0]["number"] if data else ""
    elif isinstance(data, int) and data > 0:
        value = data
    else:
        value = ""
except Exception:
    value = ""
print(value)')"

if [[ -z "$pr_number" ]]; then
  gh pr create \
    --base main \
    --head "$BRANCH" \
    --title "$PR_TITLE" \
    --body-file "$PR_BODY_FILE"
  pr_list="$(gh pr list --base main --head "$BRANCH" --state open --json number --jq '.[0].number // empty')"
  pr_number="$(printf '%s' "$pr_list" | python3 -c 'import json,sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        value = data[0]["number"] if data else ""
    elif isinstance(data, int) and data > 0:
        value = data
    else:
        value = ""
except Exception:
    value = ""
print(value)')"
else
  echo "Updated existing PR #$pr_number"
fi

[[ "$pr_number" =~ ^[1-9][0-9]*$ ]] || { echo "::error::Unable to resolve the open automation PR number." >&2; exit 1; }
head_sha="$(git rev-parse HEAD)"
pr_json="$(gh pr view "$pr_number" --json state,baseRefName,headRefName,headRefOid)"
verdict="$(PR_JSON="$pr_json" EXPECT_BRANCH="$BRANCH" EXPECT_HEAD="$head_sha" python3 -c 'import json, os
try:
    d = json.loads(os.environ["PR_JSON"])
    ok = (d.get("state") == "OPEN"
          and d.get("baseRefName") == "main"
          and d.get("headRefName") == os.environ["EXPECT_BRANCH"]
          and d.get("headRefOid") == os.environ["EXPECT_HEAD"])
except Exception:
    ok = False
print("ok" if ok else "bad")')"
if [[ "$verdict" != "ok" ]]; then
  echo "::error::The automation PR does not target main at the generated branch head." >&2
  exit 1
fi
gh workflow run ci-gate.yml --ref "$BRANCH" --field "pr_number=$pr_number" --field "head_sha=$head_sha"
