"""Stable V1 classification. Rule changes require explicit historical overrides."""
import re
import json
from pathlib import Path

AREAS = tuple(json.loads(Path(__file__).with_name('area-taxonomy.json').read_text(encoding='utf-8-sig')))
PATH_RULES = {
    'android/': ('android',), 'frontend/': ('frontend',), 'java/': ('backend',),
    'infra/': ('infra',), 'deploy/': ('infra',),
    'deploy/observability/': ('observability',), 'docs/': ('docs',),
    'keycloak-': ('auth',),
    'java/wotb-ai/': ('ai',),
    'java/wotb-core/src/main/java/com/wotb/core/replay/': ('replay',),
    'frontend/src/replay-local/': ('replay',),
    'frontend/src/replay-local/ai/': ('ai',),
    'frontend/src/replay-local/playback/': ('playback',),
    'frontend/src/components/BattlePlayback': ('playback',),
    'frontend/src/components/Playback': ('playback',),
    'frontend/src/components/ReplayShots': ('playback',),
    'frontend/src/components/AgentArmorView': ('playback',),
    'frontend/src/composables/usePlayback': ('playback',),
    'frontend/src/utils/playback': ('playback',),
    'frontend/src/styles/playback': ('playback',),
    'frontend/src/components/AiReview': ('ai',),
    'frontend/src/api/ai-review': ('ai',),
}
KEYWORDS = {
    'replay': r'\breplay\b|ReplayFacts|\bparser\b|playback data|battle facts',
    'playback': r'\b[23]D\b|\bplayback\b|shot reproduction|armor viewer|terrain rendering',
    'ai': r'AI Review|ai-service|DeepSeek|review generation',
    'auth': r'Keycloak|\bIdP\b|\blogin\b|\bauth\b|\bsession\b|cookie_not_found',
}


def label_areas(pr):
    return frozenset(label['name'][5:] for label in pr.get('labels', [])
                     if label.get('name', '').startswith('area/') and label['name'][5:] in AREAS)


def classify_area(pr, paths=(), overrides=None):
    labels = label_areas(pr)
    if labels:
        return labels
    override = (overrides or {}).get(str(pr['number']))
    if override is not None:
        return frozenset(override)
    found = {area for prefix, areas in PATH_RULES.items() for area in areas
             if any(path.startswith(prefix) for path in paths)}
    if found:
        return frozenset(found)
    text = (pr.get('title') or '') + '\n' + (pr.get('body') or '')
    return frozenset(area for area, pattern in KEYWORDS.items() if re.search(pattern, text, re.I)) or frozenset({'unclassified'})


def actor_type(user):
    user = user or {}
    login = user.get('login', '').lower()
    # Only known service identities; prose about AI assistance is never identity.
    if login in {'chatgpt-codex-connector[bot]', 'claude[bot]'} and user.get('type') == 'Bot':
        return 'agent'
    if user.get('type') == 'Bot' or login in {'dependabot[bot]', 'github-actions[bot]'}:
        return 'automation'
    return 'human'
