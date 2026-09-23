#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path
import yaml
root=Path(sys.argv[1])
wd=root/'.github/workflows'
build=yaml.load((wd/'build.yml').read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
deploy=yaml.load((wd/'deploy.yml').read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
release=yaml.load((wd/'release.yml').read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
components=['business-api','frontend','keycloak','parser-worker','minio']
services=components+['caddy','rabbitmq','business-postgres','keycloak-postgres','node-exporter','prometheus','loki','alloy','grafana']
assert set(build['on']['workflow_dispatch']['inputs']['component']['options'])==set(components)
assert set(deploy['on']['workflow_dispatch']['inputs']['service']['options'])==set(services)
assert set(build['on']['workflow_call']['inputs'])=={'component','source_sha'}
assert set(deploy['on']['workflow_call']['inputs'])=={'service','source_sha','image','digest'}
assert {'image','tag','commit_sha','digest'} <= set(build['on']['workflow_call']['outputs'])
assert 'workflow_run' not in str(build) and 'workflow_run' not in str(deploy)
assert 'workflow_dispatch' in build['on'] and 'push' not in build['on']
assert 'workflow_dispatch' in deploy['on'] and 'push' not in deploy['on']
assert 'sha-' in str(build) and ':latest' not in str(build)
assert 'crane ls' in str(deploy) and 'crane digest' in str(deploy)
assert 'TX_IMAGE_REGISTRY_PREFIX' in str(deploy)
assert 'release-metadata.py' in str(deploy)
for component in components:
    dockerfile='docker/Dockerfile.'+component
    assert (root/dockerfile).exists(), dockerfile
assert not (root/'docker/Dockerfile.backend').exists()
jobs=release['jobs']
for c in components:
    job=jobs['build_'+c.replace('-','_')]
    assert job['uses']=='./.github/workflows/build.yml'
    assert job['with']['component']==c
for service in services:
    job=jobs['deploy_'+service.replace('-','_')]
    assert job['uses']=='./.github/workflows/deploy.yml'
    assert job['with']['service']==service
    if service in components:
        assert 'needs.build_'+service.replace('-','_')+'.outputs.image' in job['with']['image']
        assert 'needs.build_'+service.replace('-','_')+'.outputs.digest' in job['with']['digest']
print('single-component Build and single-service Deploy contracts OK')
PY
