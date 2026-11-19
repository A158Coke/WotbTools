#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# ---------------------------------------------------------------------------
# asset-origin: only the asset-owned transport ref `asset-origin` may be
# force-updated, and only by a run that is still EXACT current GitHub main. This
# executes the real workflow step against a disposable GitHub origin and a
# URL-rewritten local Gitee remote, so a stale queued run cannot move the asset ref
# and the Frontend/Business API mirror movement of shared `main` stays irrelevant.
# ---------------------------------------------------------------------------
asset_work="$work/asset-origin"
mkdir -p "$asset_work/runner-temp"
git init -q --bare "$asset_work/hub-bare"
git init -q --bare "$asset_work/gitee.git"
git -C "$asset_work/hub-bare" symbolic-ref HEAD refs/heads/main
git -C "$asset_work/gitee.git" symbolic-ref HEAD refs/heads/main

git init -q "$asset_work/seed"
git -C "$asset_work/seed" config user.email ci@example.invalid
git -C "$asset_work/seed" config user.name 'CI fixture'
mkdir -p "$asset_work/seed/deploy/assets"
printf 'name: wotbtools-asset-origin\n' > "$asset_work/seed/deploy/assets/compose.yaml"
git -C "$asset_work/seed" add -A
git -C "$asset_work/seed" commit -qm 'asset change'
sha_asset="$(git -C "$asset_work/seed" rev-parse HEAD)"
git -C "$asset_work/seed" remote add origin "$asset_work/hub-bare"
git -C "$asset_work/seed" push -q origin "$sha_asset":refs/heads/main
printf 'unrelated\n' > "$asset_work/seed/unrelated.txt"
git -C "$asset_work/seed" add -A
git -C "$asset_work/seed" commit -qm 'unrelated main commit'
sha_newer="$(git -C "$asset_work/seed" rev-parse HEAD)"
git clone -q "$asset_work/hub-bare" "$asset_work/repo"

# The workflow step pushes to the real Gitee URL; rewriting it to a disposable
# bare repository keeps the run offline while exercising the same command. An
# isolated HOME keeps the rewrite (and the runner's real git config) out of the
# way on every git version.
mkdir -p "$asset_work/home"
git config --file "$asset_work/home/.gitconfig" \
  url."$asset_work/gitee.git".insteadOf https://gitee.com/A158Coke/Wotbtools.git

python3 - "$ROOT" "$asset_work" <<'PY'
import pathlib, sys, yaml
root, work = map(pathlib.Path, sys.argv[1:])
workflow = yaml.load((root / '.github/workflows/asset-origin.yml').read_text(), Loader=yaml.BaseLoader)
steps = {step.get('name'): step for step in workflow['jobs']['mirror_gitee']['steps']}
(work / 'push-step.sh').write_text(steps['Push frozen event SHA to the Gitee asset-origin ref']['run'])
(work / 'input-paths').write_text(workflow['env']['PRODUCTION_INPUT_PATHS'])
PY

set_github_main() { git -C "$asset_work/seed" push -q "$asset_work/hub-bare" "+$1:refs/heads/main"; }
# Shared main is moved by the Frontend/Business API mirrors, never by this owner.
set_gitee_main() { git -C "$asset_work/seed" push -q "$asset_work/gitee.git" "+$1:refs/heads/main"; }
# The asset-owned transport ref is moved only by the asset source-transport step.
set_gitee_transport() { git -C "$asset_work/seed" push -q "$asset_work/gitee.git" "+$1:refs/heads/asset-origin"; }
gitee_main() { git -C "$asset_work/gitee.git" rev-parse --verify 'refs/heads/main^{commit}'; }
gitee_transport() { git -C "$asset_work/gitee.git" rev-parse --verify 'refs/heads/asset-origin^{commit}'; }
run_asset_push() {  # <event-name> <event-sha> <log>
  (
    cd "$asset_work/repo" || exit 1
    env \
      EVENT_NAME="$1" \
      EVENT_SHA="$2" \
      EVENT_REF=refs/heads/main \
      SOURCE_SHA="$2" \
      PRODUCTION_REQUIRE_EXACT_MAIN=1 \
      PRODUCTION_INPUT_PATHS="$(cat "$asset_work/input-paths")" \
      GITEE_USERNAME=fixture \
      GITEE_TOKEN=fixture \
      GITHUB_WORKSPACE="$ROOT" \
      RUNNER_TEMP="$asset_work/runner-temp" \
      HOME="$asset_work/home" \
      bash "$asset_work/push-step.sh"
  ) >"$3" 2>&1
}

# The step may only mutate its own transport ref.
if grep -q 'refs/heads/main' "$asset_work/push-step.sh"; then
  echo 'the asset source-transport step references shared Gitee main' >&2
  exit 1
fi

# A newer mirror and a newer asset run already published newer refs: the queued run
# for the older asset SHA must fail closed instead of moving its transport ref back.
set_github_main "$sha_newer"
set_gitee_main "$sha_newer"
set_gitee_transport "$sha_newer"
for stale_kind in push workflow_dispatch; do
  if run_asset_push "$stale_kind" "$sha_asset" "$asset_work/stale-$stale_kind.log"; then
    echo "a stale asset-origin $stale_kind run reached the Gitee asset-origin push" >&2
    exit 1
  fi
  grep -Fq 'requires the exact current main SHA' "$asset_work/stale-$stale_kind.log" || {
    echo "a stale asset-origin $stale_kind run failed for an unexpected reason" >&2
    cat "$asset_work/stale-$stale_kind.log" >&2
    exit 1
  }
  current="$(gitee_transport)"
  [ "$current" = "$sha_newer" ] || {
    echo "a stale asset-origin $stale_kind run moved the asset transport ref: $current" >&2
    exit 1
  }
  shared="$(gitee_main)"
  [ "$shared" = "$sha_newer" ] || {
    echo "a stale asset-origin $stale_kind run touched shared Gitee main: $shared" >&2
    exit 1
  }
done

# The same frozen SHA still reaches the asset-owned ref while it IS exact current
# main, and shared Gitee main (another owner's ref) is left exactly where it was.
set_github_main "$sha_asset"
if ! run_asset_push push "$sha_asset" "$asset_work/fresh-push.log"; then
  echo 'a fresh asset-origin push run was rejected' >&2
  cat "$asset_work/fresh-push.log" >&2
  exit 1
fi
current="$(gitee_transport)"
[ "$current" = "$sha_asset" ] || {
  echo "a fresh asset-origin run published the wrong asset transport ref: $current" >&2
  exit 1
}
shared="$(gitee_main)"
[ "$shared" = "$sha_newer" ] || {
  echo "a fresh asset-origin run moved shared Gitee main (Frontend/Business owner): $shared" >&2
  exit 1
}
echo 'asset-origin pins the reviewed SHA on its own ref and never touches shared main: PASS'

# asset-owned transport pair 保留；main-only sync 的 ref isolation 由真实 Git fixture 验证。
hub_transport="$(git -C "$asset_work/hub-bare" rev-parse --verify 'refs/heads/asset-origin^{commit}')"
[ "$hub_transport" = "$sha_asset" ] || {
  echo "the asset workflow did not publish the GitHub pointer branch: $hub_transport" >&2
  exit 1
}
echo 'asset-origin transport pair remains asset-owned: PASS'

# ---------------------------------------------------------------------------
# D3 helper behavior suite: scripts/ci/publish-data-update.sh
# Isolated fixtures only — a throwaway bare remote + work repo, and a fake `gh`
# on PATH. No real GitHub access, no real publishing target is ever touched.
# ---------------------------------------------------------------------------
helper_behavior_main() {
  HELPER="$ROOT/scripts/ci/publish-data-update.sh"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP" "$work"' EXIT
  FAKEBIN="$TMP/bin"; mkdir -p "$FAKEBIN"
  REAL_GIT="$(command -v git)"
  GH_LOG="$TMP/gh.log"; GIT_LOG="$TMP/git.log"; : > "$GH_LOG"; : > "$GIT_LOG"

  cat > "$FAKEBIN/git" <<EOF
#!/usr/bin/env bash
printf '%s\n' "git \$*" >> "$GIT_LOG"
exec "$REAL_GIT" "\$@"
EOF
  FAKE_CREATED="$TMP/fake-created"; export FAKE_CREATED
  cat > "$FAKEBIN/gh" <<EOF
#!/usr/bin/env bash
printf '%s\n' "gh \$*" >> "$GH_LOG"
case "\$1 \$2" in
  "pr list")
    # FAKE_LIST_OUTPUT 覆盖模拟真实 gh --jq 的裸数字输出；默认路径模拟 JSON 形态。
    if [[ -n "\${FAKE_LIST_OUTPUT+x}" ]]; then
      printf '%s\n' "\$FAKE_LIST_OUTPUT"
    elif [[ -f "$FAKE_CREATED" ]]; then
      printf '[{"number":%s}]\n' "\${FAKE_NEW_PR_NUMBER-1}"
    else
      printf '%s\n' "\${FAKE_PR_LIST:-[]}"
    fi
    exit 0 ;;
  "pr create")
    if [[ -n "\${FAKE_CREATE_EXIT:-}" && "\$FAKE_CREATE_EXIT" != "0" ]]; then
      echo "create failed (fixture)" >&2; exit "\$FAKE_CREATE_EXIT"
    fi
    : > "$FAKE_CREATED"
    exit 0 ;;
  "pr view")
    head="\${FAKE_VIEW_HEAD_OVERRIDE:-\$(git -C "\$TEST_REPO" rev-parse HEAD)}"
    printf '{"state":"%s","baseRefName":"%s","headRefName":"%s","headRefOid":"%s"}\n' \
      "\${FAKE_VIEW_STATE:-OPEN}" "\${FAKE_VIEW_BASE:-main}" "\${FAKE_VIEW_BRANCH:-\${FAKE_EXPECT_BRANCH}}" "\$head"
    exit 0 ;;
  "workflow run") exit 0 ;;
  *) echo "unexpected gh call: \$*" >&2; exit 99 ;;
esac
EOF
  chmod +x "$FAKEBIN/git" "$FAKEBIN/gh"
  export PATH="$FAKEBIN:$PATH"

  PASS=0; FAIL=0
  HELPER_ERR="$TMP/helper.err"; : > "$HELPER_ERR"
  ok() { PASS=$((PASS+1)); echo "helper behavior PASS: $1"; }
  bad() {
    FAIL=$((FAIL+1)); echo "helper behavior FAIL: $1"
    if [ -s "$HELPER_ERR" ]; then
      sed 's/^/  helper stderr| /' "$HELPER_ERR" | tail -8
    fi
    if [ -d "$TMP/repo/.git" ]; then
      git -C "$TMP/repo" log --oneline -1 2>&1 | sed 's/^/  repo head| /'
      git -C "$TMP/repo" status --porcelain 2>&1 | sed 's/^/  repo status| /' | head -5
    fi
  }

  expect_fail() { # description, then command...
    local desc="$1"; shift
    if "$@" >/dev/null 2>&1; then bad "$desc (expected failure, got success)"; else ok "$desc"; fi
  }

  setup_repo() {
    rm -rf "$TMP/repo" "$TMP/remote.git"
    rm -f "$FAKE_CREATED"
    git init -q --bare -b main "$TMP/remote.git"
    git init -q -b main "$TMP/repo"
    (
      cd "$TMP/repo"
      git config user.name tester && git config user.email tester@example.com
      git remote add origin "$TMP/remote.git"
      mkdir -p common
      printf 'v1\n' > common/crew-skills.json
      printf 'v1\n' > common/tank_ids.json
      printf 'v1\n' > common/tankopedia-tier1.json
      git add common/crew-skills.json common/tank_ids.json common/tankopedia-tier1.json
      git commit -qm init
      git push -q origin main
    )
    TEST_REPO="$TMP/repo"; export TEST_REPO
  }

  BODY="$TMP/body.md"; printf 'body\n' > "$BODY"

  run_in_repo() { (cd "$TMP/repo" && bash "$HELPER" "$@") 2>"$HELPER_ERR"; }

  # 1. crew-skills normal path: new branch, force-with-lease, create PR, dispatch exact HEAD.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  : > "$GIT_LOG"; : > "$GH_LOG"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message "chore(data): sync BlitzKit crew skills" \
    --pr-title "chore(data): sync BlitzKit crew skills" \
    --pr-body-file "$BODY" \
    --path common/crew-skills.json >/dev/null 2>&1 \
    && ok "normal path exits 0" || bad "normal path exits 0"
  git -C "$TMP/repo" rev-parse -q --verify automation/update-crew-skills >/dev/null \
    && ok "normal path created automation branch" || bad "normal path created automation branch"
  grep -q -- "--force-with-lease" "$GIT_LOG" \
    && ok "normal path pushes with --force-with-lease" || bad "normal path pushes with --force-with-lease"
  grep -q "gh pr create" "$GH_LOG" && ok "normal path creates PR" || bad "normal path creates PR"
  head_sha="$(git -C "$TMP/repo" rev-parse HEAD)"
  grep -q "head_sha=$head_sha" "$GH_LOG" \
    && ok "dispatch carries the generated commit HEAD" || bad "dispatch carries the generated commit HEAD"
  grep -q "pr_number=" "$GH_LOG" && ok "dispatch carries pr_number" || bad "dispatch carries pr_number"
  commit_files="$(git -C "$TMP/repo" show --name-only --format= HEAD)"
  [ "$commit_files" = "common/crew-skills.json" ] \
    && ok "commit contains only the whitelisted path" || bad "commit contains only the whitelisted path (got: $commit_files)"

  # 2. no changes: no commit, no push, no PR, no dispatch.
  setup_repo; : > "$GIT_LOG"; : > "$GH_LOG"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && ok "unchanged paths exit 0" || bad "unchanged paths exit 0"
  if grep -q "git push" "$GIT_LOG" || grep -q "pr create" "$GH_LOG" || grep -q "workflow run" "$GH_LOG"; then
    bad "unchanged paths must not push/create/dispatch"
  else
    ok "unchanged paths must not push/create/dispatch"
  fi

  # 3. existing PR（真实 gh --jq 的裸数字输出形态）: no create, dispatch with that number.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  : > "$GH_LOG"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills FAKE_LIST_OUTPUT=7 run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && ok "existing-PR path exits 0" || bad "existing-PR path exits 0"
  grep -q "gh pr create" "$GH_LOG" && bad "existing-PR path must not create a PR" || ok "existing-PR path must not create a PR"
  grep -q "pr_number=7" "$GH_LOG" && ok "existing-PR path dispatches pr_number=7" || bad "existing-PR path dispatches pr_number=7"

  # 4. unresolvable PR number (create ok but list stays empty): fail, no dispatch.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  : > "$GH_LOG"
  export FAKE_NEW_PR_NUMBER=
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && bad "unresolvable PR number must fail" || ok "unresolvable PR number must fail"
  grep -q "workflow run" "$GH_LOG" && bad "unresolvable PR number must not dispatch" || ok "unresolvable PR number must not dispatch"
  unset FAKE_NEW_PR_NUMBER

  # 5. wrong state / base / branch / head OID: fail, no dispatch.
  mismatch_names=(FAKE_VIEW_STATE FAKE_VIEW_BASE FAKE_VIEW_BRANCH FAKE_VIEW_HEAD_OVERRIDE)
  mismatch_vals=(MERGED develop automation/update-equipment 0000000000000000000000000000000000000000)
  for i in 0 1 2 3; do
    export "${mismatch_names[$i]}=${mismatch_vals[$i]}"
    setup_repo
    printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
    : > "$GH_LOG"
    FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
      --branch automation/update-crew-skills \
      --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
      && bad "PR identity mismatch (${mismatch_names[$i]}) must fail" || ok "PR identity mismatch (${mismatch_names[$i]}) must fail"
    grep -q "workflow run" "$GH_LOG" \
      && bad "PR identity mismatch (${mismatch_names[$i]}) must not dispatch" || ok "PR identity mismatch (${mismatch_names[$i]}) must not dispatch"
    unset "${mismatch_names[$i]}"
  done

  # 6. gh pr create failure: fail, no dispatch.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  : > "$GH_LOG"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills FAKE_CREATE_EXIT=1 run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && bad "gh create failure must fail the helper" || ok "gh create failure must fail the helper"
  grep -q "workflow run" "$GH_LOG" && bad "gh create failure must not dispatch" || ok "gh create failure must not dispatch"

  # 6b. git push failure: fail.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  printf '#!/usr/bin/env bash\nexit 1\n' > "$TMP/remote.git/hooks/pre-receive"
  chmod +x "$TMP/remote.git/hooks/pre-receive"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && bad "git push failure must fail the helper" || ok "git push failure must fail the helper"
  rm -f "$TMP/remote.git/hooks/pre-receive"

  # 7. Tankopedia same-source path: no branch switch, plain push (no force flag).
  setup_repo
  git -C "$TMP/repo" switch -qC automation/update-tankopedia
  printf 'v2\n' > "$TMP/repo/common/tank_ids.json"
  : > "$GIT_LOG"
  FAKE_EXPECT_BRANCH=automation/update-tankopedia run_in_repo \
    --branch automation/update-tankopedia --source-ref automation/update-tankopedia \
    --commit-message "chore(data): sync BlitzKit Tankopedia" --pr-title t --pr-body-file "$BODY" \
    --path 'common/tankopedia-tier*.json' --path common/tank_ids.json >/dev/null 2>&1 \
    && ok "same-source path exits 0" || bad "same-source path exits 0"
  grep -q "git switch" "$GIT_LOG" && bad "same-source path must not switch branches" || ok "same-source path must not switch branches"
  grep -q -- "--force-with-lease" "$GIT_LOG" \
    && bad "same-source path keeps the plain push" || ok "same-source path keeps the plain push"

  # 8. Tankopedia different-source path: switch -C + force-with-lease.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/tank_ids.json"
  : > "$GIT_LOG"
  FAKE_EXPECT_BRANCH=automation/update-tankopedia run_in_repo \
    --branch automation/update-tankopedia --source-ref main \
    --commit-message "chore(data): sync BlitzKit Tankopedia" --pr-title t --pr-body-file "$BODY" \
    --path 'common/tankopedia-tier*.json' --path common/tank_ids.json >/dev/null 2>&1 \
    && ok "different-source path exits 0" || bad "different-source path exits 0"
  grep -q "git switch -C automation/update-tankopedia" "$GIT_LOG" \
    && ok "different-source path switches to the automation branch" || bad "different-source path switches to the automation branch"
  grep -q -- "--force-with-lease" "$GIT_LOG" \
    && ok "different-source path pushes with --force-with-lease" || bad "different-source path pushes with --force-with-lease"

  # 9. unexpected staged content: refuse, no commit, no push, no PR.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  printf 'x\n' > "$TMP/repo/other.txt"
  git -C "$TMP/repo" add other.txt
  : > "$GIT_LOG"; : > "$GH_LOG"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && bad "unexpected staged content must be refused" || ok "unexpected staged content must be refused"
  grep -q "git commit" "$GIT_LOG" && bad "unexpected staged content must not commit" || ok "unexpected staged content must not commit"
  grep -q "git push" "$GIT_LOG" && bad "unexpected staged content must not push" || ok "unexpected staged content must not push"

  # 10. shell metacharacters in arguments stay data, never execute.
  setup_repo
  printf 'v2\n' > "$TMP/repo/common/crew-skills.json"
  rm -f "$TMP/pwned"
  FAKE_EXPECT_BRANCH=automation/update-crew-skills run_in_repo \
    --branch automation/update-crew-skills \
    --commit-message "msg with 'quotes' and \$(touch $TMP/pwned) and \"dq\"" \
    --pr-title "title with 'quotes'" --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && ok "metacharacter args path exits 0" || bad "metacharacter args path exits 0"
  [ ! -e "$TMP/pwned" ] && ok "metacharacters were not executed" || bad "metacharacters were not executed"
  commit_subject="$(git -C "$TMP/repo" log -1 --format=%s)"
  [ "$commit_subject" = "msg with 'quotes' and \$(touch $TMP/pwned) and \"dq\"" ] \
    && ok "commit message preserved literally" || bad "commit message preserved literally (got: $commit_subject)"

  # 11. non-allowlist branch is rejected outright.
  setup_repo
  run_in_repo --branch main \
    --commit-message m --pr-title t --pr-body-file "$BODY" --path common/crew-skills.json >/dev/null 2>&1 \
    && bad "non-allowlist branch must be rejected" || ok "non-allowlist branch must be rejected"

  echo "helper behavior suite: PASS=$PASS FAIL=$FAIL"
  [ "$FAIL" -eq 0 ] || exit 1
}
helper_behavior_main
