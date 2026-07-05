<script setup>
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import * as api from '../utils/api.js'
import versions from '../data/versions.json'
const { locale, t } = useI18n()
const { initPromise, tokenParsed } = useAuth()
const isAdmin = ref(false)
const topDamage = ref(null)
const topDamageDisplay = computed(() => topDamage.value == null ? '--' : formatDamage(topDamage.value))

onMounted(() => {
  initPromise
    .then(() => {
      const tp = tokenParsed.value
      const roles = [
        ...(tp?.realm_access?.roles || []),
      ]
      isAdmin.value = roles.includes('wotbtools-admin')
    })
    .catch(() => {
      isAdmin.value = false
    })
  loadTopDamageRecord()
})

function versionTagLabel(tag) {
  if (tag === 'add') return t('version.added')
  if (tag === 'fix') return t('version.fixed')
  return t(`version.${tag}`)
}

async function loadTopDamageRecord() {
  try {
    const res = await api.leaderboardTopDamage(1, 1)
    const damage = Number(res?.items?.[0]?.damageDealt)
    topDamage.value = Number.isFinite(damage) ? damage : null
  } catch {
    topDamage.value = null
  }
}

function formatDamage(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}
</script>

<template>
  <div class="homepage">
    <header class="home-hero">
      <div class="hero-copy">
        <img class="header-logo" src="/wotbtoolslogo.png" alt="WoTBTools">
        <h1>{{ $t('app.title') }}</h1>
        <p class="subtitle">{{ $t('app.subtitle') }}</p>
        <div class="hero-actions">
          <a class="hero-btn" href="/?view=replay">{{ $t('home.replayTitle') }}</a>
          <a class="hero-link" href="/?view=leaderboard">{{ $t('leaderboard.btn') }}</a>
        </div>
      </div>
      <div class="hero-panel" aria-hidden="true">
        <div class="scope-ring"></div>
        <div class="armor-plate plate-a"></div>
        <div class="armor-plate plate-b"></div>
        <div class="hero-stat">
          <span>{{ $t('home.highestDamageRecord') }}</span>
          <strong>{{ topDamageDisplay }}</strong>
        </div>
      </div>
    </header>

    <div class="tools">
      <a class="card primary" href="/?view=replay">
        <span class="card-mark">01</span>
        <h2>{{ $t('home.replayTitle') }}</h2>
        <p>{{ $t('home.replayDesc') }}</p>
        <span class="tag avail">{{ $t('home.available') }}</span>
      </a>

      <a class="card" href="/?view=leaderboard">
        <span class="card-mark">02</span>
        <h2>{{ $t('leaderboard.btn') }}</h2>
        <p>{{ $t('home.leaderboardDesc') }}</p>
        <span class="tag avail">{{ $t('home.available') }}</span>
      </a>

      <a class="card" href="/?view=extended">
        <span class="card-mark">03</span>
        <h2>{{ $t('home.ratingV2Title') }}</h2>
        <p>{{ $t('home.ratingV2Desc') }}</p>
        <span class="tag avail">{{ $t('extended.nav') }}</span>
      </a>

      <a v-if="isAdmin" class="card" href="/?view=admin-users">
        <span class="card-mark">04</span>
        <h2>{{ $t('admin.cardTitle') }}</h2>
        <p>{{ $t('admin.cardDesc') }}</p>
        <span class="tag avail">{{ $t('admin.cardBadge') }}</span>
      </a>

      <div class="coming-soon">
        <div class="card">
          <span class="card-mark">--</span>
          <h2>{{ $t('home.statsCardTitle') }}</h2>
          <p>{{ $t('home.statsCardDesc') }}</p>
          <span class="tag planned">{{ $t('home.planned') }}</span>
        </div>
      </div>

      <div class="coming-soon">
        <div class="card">
          <span class="card-mark">--</span>
          <h2>{{ $t('home.apiTitle') }}</h2>
          <p>{{ $t('home.apiDesc') }}</p>
          <span class="tag planned">{{ $t('home.planned') }}</span>
        </div>
      </div>

      <a class="card" href="/sponsor.html">
        <span class="card-mark">SP</span>
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
.homepage { max-width: 1120px; margin: 0 auto; padding: 22px 24px 56px; }
.home-hero {
  position: relative;
  min-height: 330px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  align-items: center;
  gap: 28px;
  overflow: hidden;
  border: 1px solid var(--border-header);
  border-radius: 8px;
  padding: 34px;
  background:
    linear-gradient(115deg, rgba(15, 20, 18, .88), rgba(33, 43, 29, .72) 48%, rgba(201, 141, 32, .22)),
    linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px),
    linear-gradient(0deg, rgba(255,255,255,.04) 1px, transparent 1px),
    var(--bg-card2);
  background-size: auto, 54px 54px, 54px 54px, auto;
  box-shadow: var(--surface-shadow);
}
.home-hero::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 4px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
}
.hero-copy { position: relative; z-index: 1; max-width: 610px; }
.header-logo { width: 74px; height: 74px; border-radius: 8px; box-shadow: 0 16px 30px rgba(0,0,0,.24); }
.home-hero h1 { font-size: 3.2rem; font-weight: 800; color: rgb(var(--hero-fg-rgb)); margin: 18px 0 8px; letter-spacing: 0; }
.subtitle { max-width: 520px; color: rgb(var(--hero-fg-rgb) / .78); font-size: 1.05rem; line-height: 1.7; }
.hero-actions { display: flex; align-items: center; gap: 14px; margin-top: 24px; flex-wrap: wrap; }
.hero-btn, .hero-link { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; border-radius: 6px; font-weight: 800; text-decoration: none; }
.hero-btn { padding: 0 22px; background: var(--accent); color: var(--accent-text); border: 1px solid var(--accent); }
.hero-btn:hover { background: var(--accent-hover); color: var(--accent-text); text-decoration: none; }
.hero-link { padding: 0 16px; color: rgb(var(--hero-fg-rgb)); border: 1px solid rgb(var(--hero-fg-rgb) / .28); }
.hero-link:hover { color: rgb(var(--hero-fg-rgb)); border-color: rgb(var(--hero-fg-rgb) / .52); text-decoration: none; }
.hero-panel { position: relative; height: 260px; }
.scope-ring { position: absolute; inset: 20px 28px 28px 20px; border: 2px solid rgba(217, 154, 37, .5); border-radius: 50%; }
.scope-ring::before, .scope-ring::after { content: ""; position: absolute; background: rgba(217, 154, 37, .5); }
.scope-ring::before { left: 50%; top: -18px; bottom: -18px; width: 2px; }
.scope-ring::after { top: 50%; left: -18px; right: -18px; height: 2px; }
.armor-plate { position: absolute; border: 1px solid rgba(247, 240, 223, .16); border-radius: 8px; background: linear-gradient(135deg, rgba(247,240,223,.12), rgba(247,240,223,.02)); }
.plate-a { width: 190px; height: 92px; right: 24px; top: 34px; transform: skewX(-12deg); }
.plate-b { width: 230px; height: 110px; left: 18px; bottom: 24px; transform: skewX(-12deg); }
.hero-stat { position: absolute; right: 26px; bottom: 34px; min-width: 170px; padding: 14px 16px; border: 1px solid rgba(217,154,37,.45); border-radius: 8px; background: rgba(15, 20, 18, .72); color: rgb(var(--hero-fg-rgb)); }
.hero-stat span { display: block; font-size: 12px; color: rgb(var(--hero-fg-rgb) / .66); }
.hero-stat strong { display: block; margin-top: 4px; font-size: 1.7rem; color: var(--accent-light); font-variant-numeric: tabular-nums; }
.tools { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; margin-top: 18px; }
.card {
  min-height: 152px;
  position: relative;
  background: linear-gradient(180deg, var(--bg-card), color-mix(in srgb, var(--bg-card2) 42%, var(--bg-card)));
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 22px 20px;
  text-decoration: none;
  color: inherit;
  display: block;
  transition: border-color .2s, box-shadow .2s, transform .2s;
}
.card:hover { border-color: var(--accent); box-shadow: 0 16px 34px var(--accent-shadow); transform: translateY(-2px); text-decoration: none; }
.card.primary { border-color: color-mix(in srgb, var(--accent) 42%, var(--border)); }
.card-mark { position: absolute; right: 16px; top: 14px; color: var(--text-sub); font-size: 12px; font-weight: 800; letter-spacing: .08em; }
.card h2 { font-size: 1.12rem; margin: 0 0 8px; color: var(--text-heading); }
.card p { max-width: 92%; font-size: .86rem; color: var(--text-muted); line-height: 1.55; }
.tag { display: inline-block; margin-top: 12px; padding: 3px 9px; border-radius: 6px; font-size: .72rem; font-weight: 800; }
.avail { background: var(--bg-rating); color: var(--accent-dark); }
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
.ver-tag.add { background: var(--tag-bg); color: var(--accent-dark); }
.ver-tag.fix { background: var(--status-err-bg); color: var(--status-err-fg); }
.ver p { font-size: .8rem; color: var(--text-muted); margin: 2px 0 0; flex-basis: 100%; }
footer { margin-top: 32px; text-align: center; font-size: .75rem; color: var(--text-muted); }
@media (max-width: 820px) {
  .home-hero { grid-template-columns: 1fr; padding: 26px; }
  .hero-panel { display: none; }
  .home-hero h1 { font-size: 2.45rem; }
}
@media (max-width: 560px) {
  .homepage { padding: 14px 12px 44px; }
  .home-hero { min-height: 300px; padding: 22px; }
  .header-logo { width: 56px; height: 56px; }
  .home-hero h1 { font-size: 2rem; }
  .tools { grid-template-columns: 1fr; gap: 12px; }
}
</style>
