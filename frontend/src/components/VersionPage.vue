<script setup>
import { useI18n } from 'vue-i18n'
import versions from '../data/versions.json'

const { locale, t } = useI18n()

function versionTagLabel(tag) {
  if (tag === 'add') return t('version.added')
  if (tag === 'fix') return t('version.fixed')
  if (tag === 'chg') return t('version.changed')
  if (tag === 'rem') return t('version.removed')
  return tag
}
</script>

<template>
  <div class="version-page">
    <h1 class="version-page-title">{{ $t('version.title') }}</h1>
    <div class="ver" v-for="(ver, i) in versions" :key="i">
      <span class="ver-num">v{{ ver.v }}</span>
      <span class="ver-date">{{ ver.date }}</span>
      <span class="ver-tag" :class="ver.tag">{{ versionTagLabel(ver.tag) }}</span>
      <p>{{ ver[locale] || ver.zh }}</p>
    </div>
  </div>
</template>

<style scoped>
.version-page { max-width: 1120px; margin: 0 auto; padding: 22px 24px 56px; }
.version-page-title { font-size: 1.3rem; color: var(--text-heading); margin: 8px 0 18px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.ver { margin-bottom: 12px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.ver-num { font-size: .85rem; font-weight: 700; color: var(--accent); min-width: 56px; }
.ver-date { font-size: .78rem; color: var(--text-muted); }
.ver-tag { font-size: .72rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; }
.ver-tag.add { background: var(--tag-bg); color: var(--accent-dark); }
.ver-tag.fix { background: var(--status-err-bg); color: var(--status-err-fg); }
.ver p { font-size: .82rem; color: var(--text-muted); margin: 2px 0 0; flex-basis: 100%; line-height: 1.55; }
@media (width < 768px) { .version-page { padding: 14px 12px 44px; } }
</style>
