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

# --- Dockerfile reactor inputs -------------------------------------------------
# Every image pre-copies all module poms (Maven resolves the aggregator's <modules>
# before it applies -pl), and every reactor image must copy the sources of that
# reactor's whole `-am` closure: a reactor module with a pom but no sources compiles
# into an empty jar, so the dependent module dies with "package ... does not exist".
# Deriving the closure from the poms keeps each Dockerfile honest instead of
# hand-maintaining a COPY list per image.
import re
import xml.etree.ElementTree as ET

namespace={'m':'http://maven.apache.org/POM/4.0.0'}
pom_root=ET.parse(root/'java/pom.xml').getroot()
maven_modules=[e.text.strip() for e in pom_root.findall('./m:modules/m:module', namespace)]
assert maven_modules, 'java/pom.xml must declare its modules'
for image in ('business-api','parser-worker'):
    dockerfile=(root/f'docker/Dockerfile.{image}').read_text(encoding='utf-8')
    for module in maven_modules:
        assert f'COPY java/{module}/pom.xml java/{module}/pom.xml' in dockerfile, \
            f'docker/Dockerfile.{image} must pre-copy java/{module}/pom.xml'
assert '-pl wotb-parser-worker -am' in (root/'docker/Dockerfile.parser-worker').read_text(encoding='utf-8'), \
    'docker/Dockerfile.parser-worker must build the parser-worker reactor'

def module_dependencies(module):
    pom=ET.parse(root/f'java/{module}/pom.xml').getroot()
    dependencies=set()
    for dependency in pom.findall('./m:dependencies/m:dependency', namespace):
        group=dependency.findtext('m:groupId', default='', namespaces=namespace)
        artifact=dependency.findtext('m:artifactId', default='', namespaces=namespace)
        scope=dependency.findtext('m:scope', default='', namespaces=namespace)
        if group=='com.wotb' and artifact in maven_modules and scope!='test':
            dependencies.add(artifact)
    return dependencies

def reactor_closure(roots):
    closure=set()
    pending=list(roots)
    while pending:
        current=pending.pop()
        if current in closure:
            continue
        closure.add(current)
        pending.extend(module_dependencies(current))
    return closure

reactor_builds_checked=0
for dockerfile_path in sorted((root/'docker').glob('Dockerfile.*')):
    dockerfile=dockerfile_path.read_text(encoding='utf-8')
    for reactor in re.findall(r'-pl ([A-Za-z0-9_,-]+) -am', dockerfile):
        roots=[name.strip() for name in reactor.split(',') if name.strip()]
        for module in sorted(reactor_closure(roots)):
            assert f'COPY java/{module}/src java/{module}/src' in dockerfile, \
                f'docker/{dockerfile_path.name} must copy java/{module}/src (-pl {reactor} -am)'
        reactor_builds_checked+=1
assert reactor_builds_checked>0, 'no Dockerfile reactor build was discovered; the closure check is idle'
print('single-component Build, single-service Deploy and Dockerfile reactor contracts OK')
PY
