#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin" "$WORK/deploy" "$WORK/config" "$WORK/android-release"
cp "$ROOT/deploy/docker-compose.prod.yml" "$WORK/docker-compose.yml"
cat > "$WORK/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
if [ -n "${FAKE_DOCKER_LOG:-}" ]; then
  printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
fi
if [[ "$*" == *psql* ]]; then
  printf '22\n'
  exit 0
fi
if [[ "$*" == *run* ]]; then
  printf '200\n'
  exit 0
fi
exit 0
FAKE_DOCKER
chmod 700 "$WORK/bin/docker"

set +e
output="$(env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_DIR="$WORK" WOTB_RECOVERY_SERVICE=backend WOTB_RECOVERY_MODE=specific \
  WOTB_RECOVERY_SHA=1111111111111111111111111111111111111111 \
  WOTB_TARGET_SCHEMA_MAX=21 bash "$ROOT/deploy/ops-recovery.sh" 2>&1)"
rc=$?
set -e
[ "$rc" -ne 0 ]
grep -q 'older than live schema' <<< "$output"
[ ! -e "$WORK/deploy.incoming" ]

cat > "$WORK/production-release.json" <<'JSON'
{
  "schemaVersion": 1,
  "services": {
    "wotb-backend": {
      "commitSha": "1111111111111111111111111111111111111111",
      "imageTag": "sha-111111111111",
      "deployedAt": "2026-01-01T00:00:00Z",
      "schemaVersion": 22,
      "migrationMaxVersion": 22
    },
    "wotb-frontend": {
      "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "imageTag": "sha-aaaaaaaaaaaa",
      "deployedAt": "2026-01-01T00:00:00Z"
    },
    "keycloak": {
      "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "imageTag": "sha-aaaaaaaaaaaa",
      "deployedAt": "2026-01-01T00:00:00Z"
    }
  }
}
JSON
success_log="$WORK/recovery-success.log"
env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
  WOTB_DIR="$WORK" WOTB_RECOVERY_SERVICE=backend WOTB_RECOVERY_MODE=current \
  WOTB_RECOVERY_RUN_NUMBER=8 \
  DB_PASSWORD=not-real KC_ADMIN_PASSWORD=not-real WG_APPLICATION_ID=not-real \
  KEYCLOAK_ADMIN_CLIENT_SECRET=not-real AI_API_KEY=not-real \
  GRAFANA_ADMIN_USER=not-real GRAFANA_ADMIN_PASSWORD=not-real \
  WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 \
  FAKE_DOCKER_LOG="$success_log" \
  bash "$ROOT/deploy/ops-recovery.sh"
grep -q ' up .*wotb-backend' "$success_log"
! grep -Eq ' up .*wotb-frontend| up .*keycloak| up .*postgres' "$success_log"
[ "$(find "$WORK" -maxdepth 1 -name 'deploy.incoming.recovery.*' -print | wc -l)" -eq 0 ]

workflow="$ROOT/.github/workflows/ops-recovery.yml"
grep -q '^  workflow_dispatch:' "$workflow"
! grep -q '^  workflow_run:' "$workflow"
! grep -q -- '- all' "$workflow"
grep -q 'target_sha' "$workflow"
grep -q 'migration ceiling' "$workflow"
! grep -q 'ref: \${{ inputs.target_sha || github.sha }}' "$workflow"
! grep -q 'ref: \${{ needs.prepare.outputs.target_sha }}' "$workflow"
[ "$(grep -Fc 'ref: \${{ github.sha }}' "$workflow")" -ge 2 ]
grep -q 'git ls-tree -r --name-only "\$target_sha"' "$workflow"
grep -q 'source: deploy' "$workflow"
echo "specific SHA uses historical source only for identity/migration lookup; control-plane stays trusted"
echo "Ops Recovery schema guard contract OK"
