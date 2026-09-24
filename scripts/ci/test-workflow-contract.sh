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
    assert set(dispatch)=={input_name}, (name, dispatch)
    assert dispatch[input_name]['options']==expected
    call_inputs=workflow['on']['workflow_call']['inputs']
    expected_call_inputs={
        'Build':{'component','source_sha'},
        'Deploy':{'service','source_sha','image','digest'},
        'Infra / Tofu Apply':{'root','source_sha'},
    }[name]
    assert set(call_inputs)==expected_call_inputs, (name, call_inputs)
    for required_input in (input_name,'source_sha'):
        assert call_inputs[required_input]['required']=='true'
        assert call_inputs[required_input]['type']=='string'
    if name=='Deploy':
        for optional_input in ('image','digest'):
            assert call_inputs[optional_input]['required']=='false'
            assert call_inputs[optional_input]['type']=='string'
assert build['on']['workflow_call']['inputs']['source_sha']['required']=='true'
assert {'image','tag','commit_sha','digest'} <= set(build['on']['workflow_call']['outputs'])
assert deploy['on']['workflow_call']['inputs']['source_sha']['required']=='true'
assert tofu['on']['workflow_call']['inputs']['source_sha']['required']=='true'

domain_files={
    'foundation':'release-foundation.yml',
    'cloud':'release-cloud.yml',
    'tx':'release-tx.yml',
    'yecao':'release-yecao.yml',
    'observability':'release-observability.yml',
}
domain_selection_fields={
    'foundation':('build_components','deploy_services','tofu_roots'),
    'cloud':('tofu_roots',),
    'tx':('build_components','deploy_services','tofu_roots'),
    'yecao':('build_components','deploy_services'),
    'observability':('deploy_services','tofu_roots'),
}
domains={name:yaml.load((workflow_dir/filename).read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
         for name,filename in domain_files.items()}

# The production Release stays legible at the top level: planning, five business
# domains, and one summary. Recovery is still the same workflow and only accepts a
# required base commit; automatic pushes keep using the event's before SHA.
assert release['on']['push']['branches']==['main']
assert 'workflow_dispatch' in release['on']
base_input=release['on']['workflow_dispatch']['inputs']['base_sha']
assert base_input['required']=='true' and base_input['type']=='string'
jobs=release['jobs']
top_level_jobs={'plan','foundation','cloud','tx','yecao','observability','summary'}
assert set(jobs)==top_level_jobs, set(jobs)
assert len(jobs)<=8
assert set(jobs['plan']['outputs']) >= {'source_sha','base_sha','build_components','deploy_services','tofu_roots'}
plan_text=str(jobs['plan'])
assert 'deploy/release_plan.py --base' in plan_text and '--head' in plan_text
for range_guard in ('base="$EVENT_BEFORE"','base="$INPUT_BASE_SHA"',
                    'git cat-file -e "$base^{commit}"',
                    'git merge-base --is-ancestor "$base" "$head"',
                    'git rev-parse origin/main'):
    assert range_guard in plan_text, range_guard
release_text=(workflow_dir/'release.yml').read_text(encoding='utf-8')
assert 'inputs.base_sha' in release_text and 'github.event.before' in release_text
assert 'workflow_dispatch' in release_text and 'refs/heads/main' in release_text
for domain_name,filename in domain_files.items():
    job=jobs[domain_name]
    assert job['uses']=='./.github/workflows/'+filename
    assert 'plan' in job.get('needs',[])
    condition=job.get('if','')
    assert "needs.plan.result == 'success'" in condition, domain_name
    for selection in domain_selection_fields[domain_name]:
        assert 'needs.plan.outputs.'+selection in condition, (domain_name, selection)
    if domain_name in ('tx','yecao'):
        assert 'always()' in condition and '!cancelled()' in condition, domain_name
        assert 'needs.foundation.result' not in condition, domain_name
        assert domain_name != 'tx' or 'needs.cloud.result' not in condition, domain_name
        assert 'observability' not in job.get('needs',[]), domain_name
        assert 'tx' not in job.get('needs',[]), domain_name
    assert {'source_sha','build_components','deploy_services','tofu_roots'} <= set(job.get('with',{}))
    for field in ('source_sha','build_components','deploy_services','tofu_roots'):
        assert 'needs.plan.outputs.'+field in job['with'][field], (domain_name, field, job['with'][field])
summary=jobs['summary']
assert set(summary.get('needs',[]))==top_level_jobs-{'summary'}
assert 'always()' in summary.get('if','')

# Each domain is reusable by Release only. The planner's shared string inputs are
# the only cross-domain selection contract; leaf workflows remain the executors.
for domain_name,domain in domains.items():
    assert set(domain['on'])=={'workflow_call'}, (domain_name, domain['on'])
    call_inputs=domain['on']['workflow_call']['inputs']
    assert {'source_sha','build_components','deploy_services','tofu_roots'} <= set(call_inputs)
    for name in ('source_sha','build_components','deploy_services','tofu_roots'):
        assert call_inputs[name]['required']=='true' and call_inputs[name]['type']=='string', (domain_name, name)
    assert 'workflow_run' not in domain['on']

def permissions_for(workflow, job):
    permissions=job.get('permissions',workflow.get('permissions',{}))
    assert isinstance(permissions,dict), permissions
    return permissions

permission_rank={'none':0,'read':1,'write':2}
def require_permissions(workflow, job, package_level, caller):
    permissions=permissions_for(workflow,job)
    assert permission_rank.get(permissions.get('contents','none'),0)>=permission_rank['read'], \
        f'{caller} must grant contents: read'
    actual=permissions.get('packages','none')
    assert permission_rank.get(actual,0)>=permission_rank[package_level], \
        f'{caller} needs packages: {package_level}, got {actual}'

# The leaf jobs themselves retain the access their operation needs.
require_permissions(build,build['jobs']['build'],'write','Build publisher')
require_permissions(deploy,deploy['jobs']['identity'],'read','Deploy image resolver')

release_package_levels={'foundation':'write','cloud':None,'tx':'write','yecao':'write','observability':'read'}
for domain_name,job in ((name,jobs[name]) for name in domain_files):
    assert job.get('secrets')=='inherit' or (isinstance(job.get('secrets'),dict) and job['secrets']), \
        f'Release -> {domain_name} must pass the required reusable-workflow secrets'
    release_permissions=permissions_for(release,job)
    assert permission_rank.get(release_permissions.get('contents','none'),0)>=1, \
        f'Release -> {domain_name} must grant contents: read'
    level=release_package_levels[domain_name]
    if level:
        require_permissions(release,job,level,'Release -> '+domain_name)

# Check permissions at the actual reusable-call boundary. Build publishes package
# images; Deploy only reads the immutable package selected by Build or metadata.
leaf_calls={'./.github/workflows/build.yml':'write',
            './.github/workflows/deploy.yml':'read',
            './.github/workflows/tofu-apply.yml':None}
leaf_targets={'./.github/workflows/build.yml':'component',
              './.github/workflows/deploy.yml':'service',
              './.github/workflows/tofu-apply.yml':'root'}
build_callers={}
deploy_callers={}
tofu_callers={}
for domain_name,domain in domains.items():
    found_leaf_call=False
    for job_name,job in domain.get('jobs',{}).items():
        callee=job.get('uses')
        if callee is None:
            continue
        assert callee in leaf_calls, f'{domain_name}.{job_name} must call a supported release leaf, got {callee}'
        found_leaf_call=True
        call_inputs=job.get('with',{})
        assert leaf_targets[callee] in call_inputs, f'{domain_name}.{job_name} is missing {leaf_targets[callee]}'
        assert 'inputs.source_sha' in call_inputs.get('source_sha',''), \
            f'{domain_name}.{job_name} must forward its frozen source_sha to {callee}'
        target=call_inputs[leaf_targets[callee]]
        target_set={'./.github/workflows/build.yml':components,
                    './.github/workflows/deploy.yml':services,
                    './.github/workflows/tofu-apply.yml':roots}[callee]
        assert target in target_set, (domain_name, job_name, callee, target)
        caller_map={'./.github/workflows/build.yml':build_callers,
                    './.github/workflows/deploy.yml':deploy_callers,
                    './.github/workflows/tofu-apply.yml':tofu_callers}[callee]
        assert target not in caller_map, f'{target} has multiple {callee} callers'
        caller_map[target]=(domain_name,job_name,call_inputs)
        assert job.get('secrets')=='inherit' or (isinstance(job.get('secrets'),dict) and job['secrets']), \
            f'{domain_name}.{job_name} -> {callee} must pass the required reusable-workflow secrets'
        package_level=leaf_calls[callee]
        if package_level:
            require_permissions(domain,job,package_level,f'{domain_name}.{job_name} -> {callee}')
        else:
            permissions=permissions_for(domain,job)
            assert permission_rank.get(permissions.get('contents','none'),0)>=1, \
                f'{domain_name}.{job_name} -> Tofu Apply must grant contents: read'
    assert found_leaf_call, f'{domain_name} must call at least one release leaf workflow'
assert set(build_callers)==set(components), build_callers
assert set(deploy_callers)==set(services), deploy_callers
assert set(tofu_callers)==set(roots), tofu_callers
# always() keeps independent work moving after failures; cancellation must still stop mutations.
for domain_name,domain in domains.items():
    for job_name,job in domain.get('jobs',{}).items():
        if job.get('uses') in leaf_calls and 'always()' in job.get('if',''):
            assert '!cancelled()' in job['if'], f'{domain_name}.{job_name} must stop after cancellation'

# Assert the actual YAML operation edges, selectors, and consumer gates.
expected_needs={
    'foundation':{
        'build_minio':set(),'deploy_rabbitmq':set(),'deploy_business_postgres':set(),
        'deploy_keycloak_postgres':set(),'deploy_minio':{'build_minio'},
        'tofu_rabbitmq':{'deploy_rabbitmq'},'tofu_business_postgres':{'deploy_business_postgres'},
        'tofu_keycloak_postgres':{'deploy_keycloak_postgres'},'tofu_minio':{'deploy_minio'},
    },
    'cloud':{'tofu_cos':set()},
    'tx':{
        'build_business_api':set(),'build_frontend':set(),'build_keycloak':set(),'dependency_gates':set(),
        'deploy_keycloak':{'build_keycloak','dependency_gates'},'tofu_keycloak':{'deploy_keycloak'},
        'deploy_business_api':{'build_business_api','dependency_gates','deploy_keycloak','tofu_keycloak'},
        'deploy_frontend':{'build_frontend','dependency_gates','deploy_keycloak','tofu_keycloak','deploy_business_api'},
        'deploy_caddy':{'dependency_gates','deploy_keycloak','tofu_keycloak','deploy_business_api','deploy_frontend'},
    },
    'yecao':{
        'build_parser_worker':set(),'dependency_gates':set(),
        'deploy_parser_worker':{'build_parser_worker','dependency_gates'},
    },
    'observability':{
        'deploy_node_exporter':set(),'deploy_prometheus':set(),'deploy_loki':set(),'deploy_alloy':set(),
        'deploy_grafana':set(),'tofu_grafana':{'deploy_grafana'},
    },
}
for domain_name,expected_jobs in expected_needs.items():
    actual_jobs=domains[domain_name]['jobs']
    for job_name,expected in expected_jobs.items():
        assert set(actual_jobs[job_name].get('needs',[]))==expected, \
            f'{domain_name}.{job_name} needs {actual_jobs[job_name].get("needs",[])}'

selector_fields={
    'build':('build_components',build_callers),
    'deploy':('deploy_services',deploy_callers),
    'tofu':('tofu_roots',tofu_callers),
}
for kind,(field,callers) in selector_fields.items():
    for target,(domain_name,job_name,_) in callers.items():
        condition=domains[domain_name]['jobs'][job_name].get('if','')
        assert f"contains(fromJSON(inputs.{field}), '{target}')" in condition, \
            f'{domain_name}.{job_name} is missing its {kind}/{target} selector'
        parent_condition=jobs[domain_name].get('if','')
        assert f"contains(fromJSON(needs.plan.outputs.{field}), '{target}')" in parent_condition, \
            f'Release {domain_name} will not start for selected {kind}/{target}'

for component,(domain_name,build_job,_) in build_callers.items():
    _,deploy_job,_=deploy_callers[component]
    condition=domains[domain_name]['jobs'][deploy_job].get('if','')
    assert f"contains(fromJSON(inputs.build_components), '{component}') == false" in condition
    assert f"needs.{build_job}.result == 'success'" in condition

for tofu_root,(domain_name,tofu_job,_) in tofu_callers.items():
    if tofu_root not in deploy_callers:
        continue
    _,deploy_job,_=deploy_callers[tofu_root]
    condition=domains[domain_name]['jobs'][tofu_job].get('if','')
    assert f"contains(fromJSON(inputs.deploy_services), '{tofu_root}') == false" in condition
    assert f"needs.{deploy_job}.result == 'success'" in condition

for domain_name,job_name,consumer in (
    ('tx','deploy_keycloak','keycloak'),('tx','deploy_business_api','business_api'),
    ('tx','deploy_frontend','frontend'),('tx','deploy_caddy','caddy'),
    ('yecao','deploy_parser_worker','parser_worker'),
):
    job=domains[domain_name]['jobs'][job_name]
    assert 'dependency_gates' in job.get('needs',[])
    assert f"needs.dependency_gates.outputs.{consumer}_ready == 'true'" in job.get('if','')

for component in components:
    build_domain,build_job,_=build_callers[component]
    deploy_domain,_,deploy_inputs=deploy_callers[component]
    assert deploy_domain==build_domain, f'{component} Build and Deploy must stay in one domain'
    assert {'image','digest'} <= set(deploy_inputs), f'{component} Deploy must receive its Build image identity'
    assert f'needs.{build_job}.outputs.image' in deploy_inputs['image']
    assert f'needs.{build_job}.outputs.digest' in deploy_inputs['digest']

# Workflow-level and job-level concurrency share the same GitHub shape. Keep the
# supported queue values explicit and reject configurations that cancel a running
# production mutation while asking GitHub to retain queued work.
def check_concurrency(value, label):
    if value is None:
        return
    assert isinstance(value,dict), (label, value)
    assert set(value) <= {'group','cancel-in-progress','queue'}, (label, value)
    assert isinstance(value.get('group'),str) and value['group'].strip(), (label, value)
    cancel=value.get('cancel-in-progress','false')
    assert cancel in ('true','false'), (label, cancel)
    queue=value.get('queue')
    assert queue in (None,'single','max'), (label, queue)
    assert not (queue=='max' and cancel=='true'), (label, value)

for workflow_path in workflow_dir.glob('*.yml'):
    workflow=yaml.load(workflow_path.read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
    check_concurrency(workflow.get('concurrency'),workflow_path.name)
    for job_name,job in workflow.get('jobs',{}).items():
        check_concurrency(job.get('concurrency'),workflow_path.name+'.'+job_name)
for workflow_name,workflow in [('release.yml',release),*[(domain_files[name],domain) for name,domain in domains.items()]]:
    assert workflow.get('concurrency',{}).get('group')!='production-maintenance', workflow_name
    for job_name,job in workflow.get('jobs',{}).items():
        assert job.get('concurrency',{}).get('group')!='production-maintenance', \
            f'{workflow_name}.{job_name} must not hold the production mutation lock while calling a child'
for workflow_name in ('deploy.yml','tofu-apply.yml','database-backup.yml'):
    serialized=yaml.load((workflow_dir/workflow_name).read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
    concurrency=serialized['concurrency']
    assert concurrency['group']=='production-maintenance', workflow_name
    assert concurrency['cancel-in-progress']=='false', workflow_name
    assert concurrency['queue']=='max', workflow_name

# No release leaf or domain depends on a prior workflow event to finish a release.
for workflow in [release,build,deploy,tofu,*domains.values()]:
    assert 'workflow_run' not in workflow.get('on',{}), workflow.get('name')
for old in ('tofu-plan.yml','grafana-tofu-plan.yml','grafana-tofu-apply.yml','postgres-business-tofu.yml','postgres-keycloak-tofu.yml'):
    assert not (workflow_dir/old).exists(), old
planner=(Path(sys.argv[1])/'deploy/release_plan.py').read_text(encoding='utf-8')
assert 'buildComponents' in planner and 'deployServices' in planner and 'tofuRoots' in planner

# Exercise the report helper with a partial-success dependency gate, then ensure
# stale-attempt reports and missing plans fail closed with readable output.
import json
import subprocess
import tempfile

report_tool=root/'deploy/release_report.py'
with tempfile.TemporaryDirectory(prefix='release-report-contract-') as temporary:
    work=Path(temporary)
    plan_path=work/'release-plan.json'
    reports=work/'reports'
    output_path=work/'summary.md'
    selected={
        'buildComponents':['business-api'],
        'deployServices':['business-api'],
        'tofuRoots':['rabbitmq','cos'],
    }
    plan={
        'release':{
            'buildComponents':selected['buildComponents'],
            'deployServices':selected['deployServices'],
            'tofuRoots':selected['tofuRoots'],
        },
        'reasons':{'java/wotb-web':'business-api source changed'},
    }
    plan_path.write_text(json.dumps(plan),encoding='utf-8')
    def write_report(domain,jobs,builds=None,gates=None,attempt='1',sha='a'*40):
        folder=reports/domain
        folder.mkdir(parents=True,exist_ok=True)
        report={
            'schemaVersion':1,'runId':'123','runAttempt':attempt,'sourceSha':sha,
            'domain':domain,'selected':selected,'jobs':jobs,'builds':builds or {},
        }
        if gates is not None: report['gates']=gates
        (folder/'release-report.json').write_text(json.dumps(report),encoding='utf-8')
    image={
        'business-api':{
            'image':'ghcr.io/a158coke/wotbtools-business-api:sha-aaaaaaaaaaaa',
            'digest':'sha256:abc123','commitSha':'a'*40,'tag':'sha-aaaaaaaaaaaa',
        },
    }
    write_report('foundation',{'deploy_rabbitmq':'success','tofu_rabbitmq':'success'})
    write_report('cloud',{'tofu_cos':'success'})
    write_report('tx',{
        'build_business_api':'success','dependency_gates':'success',
        'deploy_business_api':'success',
    },image,{'business_api':[]})
    needs={
        'plan':{'result':'success'},'foundation':{'result':'success'},
        'cloud':{'result':'success'},'tx':{'result':'success'},
        'yecao':{'result':'skipped'},'observability':{'result':'skipped'},
    }
    def run_report(*args,expected=0):
        result=subprocess.run(
            [sys.executable,str(report_tool),*map(str,args)],
            text=True,capture_output=True,check=False,
        )
        assert result.returncode==expected,(result.returncode,result.stdout,result.stderr)
        return result
    common=['--plan-file',plan_path,'--needs-json',json.dumps(needs),
            '--base-sha','b'*40,'--head-sha','a'*40,
            '--run-id','123','--run-attempt','1','--reports-dir',reports,
            '--output',output_path]
    run_report('summary',*common)
    summary_text=output_path.read_text(encoding='utf-8')
    assert 'production-release-summary' not in summary_text
    assert 'build/business-api' in summary_text and 'success' in summary_text
    assert 'sha256:abc123' in summary_text and 'Dependency blockers' in summary_text

    write_report('tx',{
        'build_business_api':'success','dependency_gates':'success',
        'deploy_business_api':'skipped',
    },image,{'business_api':['foundation/deploy/rabbitmq result is failure']})
    run_report('summary',*common,expected=1)
    blocked=output_path.read_text(encoding='utf-8')
    assert 'deploy/business-api' in blocked and 'skipped' in blocked
    assert 'foundation/deploy/rabbitmq result is failure' in blocked

    write_report('tx',{
        'build_business_api':'success','dependency_gates':'success',
        'deploy_business_api':'success',
    },image,{'business_api':[]},attempt='2')
    run_report('summary',*common,expected=1)
    assert 'report runAttempt does not match' in output_path.read_text(encoding='utf-8')

    missing_plan=work/'missing-plan.json'
    run_report('summary','--plan-file',missing_plan,'--needs-json','{}',
               '--base-sha','b'*40,'--head-sha','a'*40,
               '--run-id','123','--run-attempt','1','--reports-dir',reports,
               '--output',output_path,expected=1)
    assert 'Plan artifact is missing or invalid' in output_path.read_text(encoding='utf-8')

    malformed_needs=json.dumps({'tx':None})
    run_report('summary',*common[:2],'--needs-json',malformed_needs,*common[4:],expected=1)
    malformed_summary=output_path.read_text(encoding='utf-8')
    assert 'needs entries must map job ids to objects' in malformed_summary
    assert 'Traceback' not in malformed_summary

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

# PR validation must never reach a production host: the PR workflow may not use an
# SSH/SCP action or receive a host-local production secret. Those roots
# (keycloak, rabbitmq, business-postgres, keycloak-postgres, minio) plan and apply
# exclusively in the main-only Tofu Apply workflow.
assert 'appleboy/ssh-action' not in ci_text
assert 'appleboy/scp-action' not in ci_text
for host_secret in ('secrets.TX_', 'secrets.VPS_', 'secrets.KC_', 'secrets.KEYCLOAK_', 'secrets.WG_', 'secrets.YECAO_'):
    assert host_secret not in ci_text, host_secret
assert not (Path(sys.argv[1])/'scripts/ci/remote-tofu-plan.sh').exists(), \
    'the PR-side remote planner must stay deleted'

plan_job=ci['jobs']['tofu_plans']
plan_text=str(plan_job)
assert plan_job['name']=='OpenTofu validation / ${{ matrix.root }}'
assert 'tofu fmt -check -recursive' in plan_text
assert 'tofu init -backend=false -input=false' in plan_text
assert 'tofu validate' in plan_text
assert 'test-validate-plan.sh' in plan_text
# Only the roots that reach their backend over the network may plan production state
# from the runner; every host-local root stays validation-only here.
for step in plan_job['steps']:
    if 'tofu plan' in str(step):
        assert step.get('if','').strip() == "${{ (matrix.root == 'cos' || matrix.root == 'grafana') && env.TRUSTED_PRODUCTION_RUN == 'true' }}", step['name']
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
