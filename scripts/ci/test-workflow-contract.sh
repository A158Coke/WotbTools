#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path
import yaml

root=Path(sys.argv[1])
workflow_dir=root/'.github/workflows'
ci=yaml.load((workflow_dir/'ci.yml').read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
build=yaml.load((workflow_dir/'build.yml').read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
deploy=yaml.load((workflow_dir/'deploy.yml').read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
tofu=yaml.load((workflow_dir/'tofu-apply.yml').read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
release=yaml.load((workflow_dir/'release.yml').read_text(encoding='utf-8'), Loader=yaml.BaseLoader)

assert ci['name']=='CI / PR'
assert 'pull_request' in ci['on']
assert ci['jobs']['required']['name']=='CI / Required Gate'
assert ci['jobs']['required']['if']=='always()'
assert 'tofu_plans' in ci['jobs']['required']['needs']
assert 'packaging' in ci['jobs']['required']['needs']
assert 'deploy/release_plan.py --base' in str(ci['jobs']['changes']['steps'])
assert 'buildx build' not in str(ci['jobs']['backend']['steps'])
assert 'packaging' in ci['jobs'] and 'tofu_plans' in ci['jobs']

components=['business-api','frontend','keycloak','parser-worker','minio']
services=components+['caddy','rabbitmq','business-postgres','keycloak-postgres','node-exporter','prometheus','loki','alloy','grafana']
roots=['keycloak','rabbitmq','business-postgres','keycloak-postgres','minio','cos','grafana']
for workflow,name,expected in ((build,'Build',components),(deploy,'Deploy',services),(tofu,'Infra / Tofu Apply',roots)):
    assert workflow['name']==name
    assert 'workflow_call' in workflow['on'] and 'workflow_dispatch' in workflow['on']
    assert 'push' not in workflow['on']
    dispatch=workflow['on']['workflow_dispatch']['inputs']
    input_name={'Build':'component','Deploy':'service','Infra / Tofu Apply':'root'}[name]
    assert dispatch[input_name]['options']==expected
assert build['on']['workflow_call']['inputs']['source_sha']['required']=='true'
assert {'image','tag','commit_sha','digest'} <= set(build['on']['workflow_call']['outputs'])
assert deploy['on']['workflow_call']['inputs']['source_sha']['required']=='true'
assert tofu['on']['workflow_call']['inputs']['source_sha']['required']=='true'

assert release['on']['push']['branches']==['main']
jobs=release['jobs']
assert 'select' in jobs and 'release_summary' in jobs
assert '--base "$BEFORE" --head "$HEAD"' in str(jobs['select']['steps'])
for component in components:
    assert jobs['build_'+component.replace('-','_')]['uses']=='./.github/workflows/build.yml'
for tofu_root in roots:
    assert jobs['tofu_'+tofu_root.replace('-','_')]['uses']=='./.github/workflows/tofu-apply.yml'
for service in services:
    assert jobs['deploy_'+service.replace('-','_')]['uses']=='./.github/workflows/deploy.yml'
assert 'always()' in jobs['release_summary']['if']
assert 'toJSON(needs)' in str(jobs['release_summary'])
assert 'tofu_keycloak_postgres' in jobs['deploy_keycloak']['needs']
assert 'deploy_rabbitmq' in jobs['tofu_rabbitmq']['needs']
assert 'workflow_run' not in str(build) and 'workflow_run' not in str(deploy)
for old in ('tofu-plan.yml','grafana-tofu-plan.yml','grafana-tofu-apply.yml','postgres-business-tofu.yml','postgres-keycloak-tofu.yml'):
    assert not (workflow_dir/old).exists(), old
planner=(Path(sys.argv[1])/'deploy/release_plan.py').read_text(encoding='utf-8')
assert 'buildComponents' in planner and 'deployServices' in planner and 'tofuRoots' in planner

# The CI Maven settings stay mirror-free while the local developer settings keep the
# Aliyun mirror, and no CI step may silently fall back to the local file.
import re

ci_text=(workflow_dir/'ci.yml').read_text(encoding='utf-8')
ci_settings=(root/'java/settings-ci.xml').read_text(encoding='utf-8')
local_settings=(root/'java/settings.xml').read_text(encoding='utf-8')
assert 'maven.aliyun.com' not in ci_settings
assert '<mirrors>' not in ci_settings and '<mirrorOf>' not in ci_settings
assert 'maven.aliyun.com' in local_settings and '<mirrorOf>*</mirrorOf>' in local_settings
assert 'settings.xml' not in re.sub(r'settings-ci\.xml', '', ci_text)
assert ci_text.count('-s settings-ci.xml') == 4
assert ci_text.count('-s ../java/settings-ci.xml') == 2
assert '-s settings.xml' not in ci_text

# scp-action resolves `source` against the checkout, so an absolute runner path
# uploads nothing and the remote plan dies on a missing root.tgz. The bundle must
# therefore be written inside the workspace under the same file name the remote
# step extracts.
plan_steps=ci['jobs']['tofu_plans']['steps']
bundle=[step for step in plan_steps if step.get('name')=='Bundle one selected root and read-only planner']
assert len(bundle)==1, 'the tofu plan matrix must bundle one root for its host'
assert 'GITHUB_WORKSPACE/tofu-plan-bundle' in bundle[0]['run'], bundle[0]['run']
assert 'root.tgz' in bundle[0]['run'], bundle[0]['run']
scp=[step for step in plan_steps if str(step.get('uses','')).startswith('appleboy/scp-action')]
assert len(scp)==1, 'the tofu plan matrix must stage exactly one bundle over scp'
assert scp[0]['with']['source']=='tofu-plan-bundle/*', scp[0]['with']['source']
for step in plan_steps:
    script=str(step.get('with', {}).get('script', ''))
    if 'remote-tofu-plan.sh' in script:
        assert 'root.tgz' in script, step['name']
print('CI/Build/Deploy/Tofu/Release workflow contracts OK')
PY

# Android release artifacts must land in the same TX runtime directory mounted by deploy/tx/docker-compose.yml.
if grep -Fq '/opt/wotb/android-release' .github/workflows/android-release.yml; then
  echo "ERROR: Android release workflow still targets the retired /opt/wotb runtime." >&2
  exit 1
fi
if ! grep -Fq '/opt/wotb-tx/android-release' .github/workflows/android-release.yml; then
  echo "ERROR: Android release must publish into the TX runtime bind mount." >&2
  exit 1
fi
if grep -Eq 'secrets\.VPS_(HOST|USER|PORT|SSH_KEY)' .github/workflows/android-release.yml; then
  echo "ERROR: Android release must not use the retired Yecao VPS_* SSH target." >&2
  exit 1
fi
for secret in TX_VPS_HOST TX_VPS_USER TX_VPS_PORT TX_VPS_SSH_KEY; do
  if ! grep -Fq "secrets.$secret" .github/workflows/android-release.yml; then
    echo "ERROR: Android release is missing TX SSH secret: $secret" >&2
    exit 1
  fi
done
