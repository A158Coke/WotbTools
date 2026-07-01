<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import versions from '../data/versions.json'
const { locale, t } = useI18n()
const { initPromise, tokenParsed } = useAuth()
const isAdmin = ref(false)
onMounted(async () => {
  await initPromise
  const tp = tokenParsed.value
  const roles = [
    ...(tp?.realm_access?.roles || []),
  ]
  isAdmin.value = roles.includes('wotbtools-admin')
})

function versionTagLabel(tag) {
  if (tag === 'add') return t('version.added')
  if (tag === 'fix') return t('version.fixed')
  return t(`version.${tag}`)
}
</script>

<template>
  <div class="homepage">
    <header>
      <img class="header-logo" src="/wotbtoolslogo.png" alt="WoTBTools">
      <h1>{{ $t('app.title') }}</h1>
      <p class="subtitle">{{ $t('app.subtitle') }}</p>
    </header>

    <div class="tools">
      <a class="card" href="/?view=replay">
        <h2>{{ $t('home.replayTitle') }}</h2>
        <p>{{ $t('home.replayDesc') }}</p>
        <span class="tag avail">{{ $t('home.available') }}</span>
      </a>

      <a class="card" href="/?view=leaderboard">
        <h2>{{ $t('leaderboard.btn') }}</h2>
        <p>{{ $t('home.leaderboardDesc') }}</p>
        <span class="tag avail">{{ $t('home.available') }}</span>
      </a>

      <a v-if="isAdmin" class="card" href="/?view=admin-users">
        <h2>{{ $t('admin.cardTitle') }}</h2>
        <p>{{ $t('admin.cardDesc') }}</p>
        <span class="tag avail">{{ $t('admin.cardBadge') }}</span>
      </a>

      <div class="coming-soon">
        <div class="card">
          <h2>{{ $t('home.statsCardTitle') }}</h2>
          <p>{{ $t('home.statsCardDesc') }}</p>
          <span class="tag planned">{{ $t('home.planned') }}</span>
        </div>
      </div>

      <div class="coming-soon">
        <div class="card">
          <h2>{{ $t('home.apiTitle') }}</h2>
          <p>{{ $t('home.apiDesc') }}</p>
          <span class="tag planned">{{ $t('home.planned') }}</span>
        </div>
      </div>

      <a class="card" href="/sponsor.html">
        <h2>{{ $t('home.sponsorTitle') }}</h2>
        <p>{{ $t('home.sponsorDesc') }}</p>
        <span class="tag support">{{ $t('home.sponsorTag') }}</span>
      </a>
    </div>

    <section class="version">
      <h2 class="version-title">{{ $t('home.versionTitle') }}</h2>
      <div class="ver" v-for="(ver, i) in versions" :key="i">
        <span class="ver-num">v{{ ver.v }}</span>
        <span class="ver-date">{{ ver.date }}</span>
        <span class="ver-tag" :class="ver.tag">{{ versionTagLabel(ver.tag) }}</span>
        <p>{{ ver[locale] || ver.zh }}</p>
      </div>
    </section>

    <footer>{{ $t('home.footer') }}</footer>
  </div>
</template>

<style scoped>
.homepage { max-width: 640px; margin: 0 auto; padding: 0 24px 48px; }
header { text-align: center; padding: 32px 0 24px; }
.header-logo { width: 72px; height: 72px; border-radius: 16px; }
header h1 { font-size: 2rem; font-weight: 700; color: var(--text-heading); margin: 12px 0 4px; }
.subtitle { color: var(--text-muted); font-size: 1rem; }
.tools { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin-top: 16px; }
.card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 12px; padding: 24px 20px; text-decoration: none; color: inherit; display: block;
  transition: border-color .2s, box-shadow .2s;
}
.card:hover { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-shadow); }
.card h2 { font-size: 1.15rem; margin: 0 0 6px; color: var(--text-heading); }
.card p { font-size: .85rem; color: var(--text-muted); line-height: 1.4; }
.tag { display: inline-block; margin-top: 10px; padding: 2px 10px; border-radius: 10px; font-size: .75rem; font-weight: 600; }
.avail { background: var(--tag-bg); color: var(--accent); }
.planned { opacity: .5; background: var(--tag-bg); color: var(--text-muted); }
.support { background: var(--warn-bg); color: var(--warn-text); }
.coming-soon .card { opacity: .45; cursor: default; pointer-events: none; }
.coming-soon .card:hover { border-color: var(--border); box-shadow: none; }
.version { margin-top: 32px; }
.version-title { font-size: 1rem; color: var(--text-heading); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.ver { margin-bottom: 10px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.ver-num { font-size: .8rem; font-weight: 600; color: var(--accent); min-width: 50px; }
.ver-date { font-size: .75rem; color: var(--text-muted); }
.ver-tag { font-size: .7rem; font-weight: 600; padding: 1px 6px; border-radius: 4px; }
.ver-tag.add { background: var(--tag-bg); color: var(--accent); }
.ver-tag.fix { background: #fcebeb33; color: #f85149; }
.ver p { font-size: .8rem; color: var(--text-muted); margin: 2px 0 0; flex-basis: 100%; }
footer { margin-top: 32px; text-align: center; font-size: .75rem; color: var(--text-muted); }
@media (max-width: 560px) {
  .header-logo { width: 56px; height: 56px; }
  header h1 { font-size: 1.6rem; }
  .tools { grid-template-columns: 1fr; gap: 12px; }
}
</style>
