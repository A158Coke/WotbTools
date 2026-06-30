<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from './composables/useTheme.js'
import HomePage from './components/HomePage.vue'
import ReplayPage from './components/ReplayPage.vue'
import LeaderboardPage from './components/LeaderboardPage.vue'
import ProfilePage from './components/ProfilePage.vue'
import BoostPage from './components/BoostPage.vue'

const { t } = useI18n()
const { theme, handleTheme } = useTheme()

const params = new URLSearchParams(window.location.search)
const isHomeHost = window.location.hostname === 'wotbtools.com' || window.location.hostname === 'www.wotbtools.com'
const defaultView = isHomeHost ? 'home' : 'replay'
const viewParam = params.get('view')
const activeTool = ref(['replay', 'leaderboard', 'profile', 'boost'].includes(viewParam) ? viewParam : defaultView)


function navigate(view) {
  activeTool.value = view
  const url = new URL(window.location.href)
  if (view === 'home') url.searchParams.delete('view')
  else url.searchParams.set('view', view)
  window.history.replaceState({}, '', url.toString())
}
function onLangChange(e) { localStorage.setItem('wotb-lang', e.target.value) }
</script>

<template>
  <div class="topbar">
    <a class="tb-brand" href="https://wotbtools.com">
      <img class="tb-logo" src="/wotbtoolslogo.png" alt="WoTBTools">
    </a>
    <nav>
      <button v-if="isHomeHost" :class="{ active: activeTool === 'home' }" @click="navigate('home')">{{ $t('profile.home') }}</button>
      <button :class="{ active: activeTool === 'replay' }" @click="navigate('replay')">{{ $t('app.replay_tab') }}</button>
      <button :class="{ active: activeTool === 'leaderboard' }" @click="navigate('leaderboard')">{{ $t('leaderboard.btn') }}</button>
      <button :class="{ active: activeTool === 'boost' }" @click="navigate('boost')">陪练</button>
    </nav>
    <div class="tb-spacer"></div>
    <select class="lang-select" v-model="$i18n.locale" @change="onLangChange">
      <option v-for="l in [{key:'zh',label:'中文'},{key:'en',label:'English'},{key:'ru',label:'Русский'}]" :key="l.key" :value="l.key">{{ l.label }}</option>
    </select>
    <div class="theme-bar">
      <button :class="{ active: theme === 'auto' }" @click="handleTheme('auto')" :title="$t('app.theme')">{{ $t('theme.auto') }}</button>
      <button :class="{ active: theme === 'light' }" @click="handleTheme('light')">{{ $t('theme.light') }}</button>
      <button :class="{ active: theme === 'dark' }" @click="handleTheme('dark')">{{ $t('theme.dark') }}</button>
    </div>
    <a class="auth-btn ghost" @click.prevent="navigate('profile')" href="/?view=profile">{{$t('app.profile')}}</a>
  </div>

  <div class="tb-content">
    <HomePage v-if="activeTool === 'home'" />
    <ProfilePage v-else-if="activeTool === 'profile'" />
    <LeaderboardPage v-else-if="activeTool === 'leaderboard'" />
    <BoostPage v-else-if="activeTool === 'boost'" />
    <ReplayPage v-else />
  </div>
</template>

<style>
:root {
  --bg: #f7f8fa;
  --bg-card: #fff;
  --bg-card2: #f1f4f8;
  --bg-card-hover: #e7ecf4;
  --bg-blue: #e6f1fb;
  --bg-blue-light: #eef4fb;
  --bg-upload: #fbfcfe;
  --bg-chip: #eef2f7;
  --bg-list-hover: #f3f6fa;
  --bg-rating: #f3f6fa;
  --bg-t1: #eef4fb;
  --bg-t2: #fbf1ec;
  --text: #222;
  --text-heading: #28313f;
  --text-sub: #8b94a3;
  --text-muted: #777;
  --text-label: #46566f;
  --text-upload: #3a4555;
  --text-upload-sub: #9098a6;
  --text-modal: #34465f;
  --text-rating: #555;
  --text-code: #2b3a4d;
  --border: #e3e8ef;
  --border-header: #e9edf3;
  --border-ghost: #dbe3ef;
  --border-dashed: #c2d0e4;
  --border-chip: #d7dee9;
  --border-col: #c7d3e6;
  --border-light: #eef1f6;
  --border-heavy: #d6deea;
  --border-warn: #f0d08a;
  --border-tab-active: #bcd8f2;
  --border-rating: #e4eaf1;
  --accent: #4f88d6;
  --accent-hover: #4079c9;
  --accent-dark: #185fa5;
  --accent-light: #3a82d2;
  --accent-icon: #5b86c4;
  --error: #c00;
  --warn-text: #8a5200;
  --warn-bg: #fff8e8;
  --delete: #b84a4a;
  --scroll-fade: #f7f8fa;
  --border-rating: #e4eaf1;
}

* { box-sizing: border-box; }
body { margin: 0; font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', Helvetica, Arial, sans-serif;
  background: var(--bg); color: var(--text); }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 16px 20px; }
h2 { margin: 0 0 10px; font-size: 1.1rem; color: var(--text-heading); }
.tb-content { padding-top: 52px; }
.topbar { position: fixed; top: 0; left: 0; right: 0; z-index: 100; height: 50px;
  display: flex; align-items: center; gap: 8px; padding: 8px 16px;
  background: var(--bg-card); border-bottom: 1px solid var(--border); }
.tb-brand { display: flex; align-items: center; }
.tb-logo { height: 28px; }
.topbar nav { display: flex; gap: 4px; }
.topbar nav button { padding: 6px 12px; border: 1px solid transparent; border-radius: 7px;
  background: transparent; color: var(--text-sub); cursor: pointer; font-size: .85rem; font-family: inherit; white-space: nowrap; }
.topbar nav button.active { background: var(--bg-blue); color: var(--accent-dark); border-color: var(--border-tab-active); font-weight: 600; }
.topbar nav button:hover { background: var(--bg-card-hover); color: var(--text-label); }
.tb-spacer { flex: 1; }
.auth-btn { padding: 6px 14px; border: 1px solid var(--border-ghost); border-radius: 7px;
  background: var(--bg-card2); color: var(--text-label); cursor: pointer; font-size: .82rem; font-family: inherit; white-space: nowrap; }
.auth-btn:hover { background: var(--bg-blue-light); border-color: var(--accent); color: var(--accent-dark); text-decoration: none; }

/* ---- tabs ---- */
.tabs { display: flex; gap: 4px; margin-bottom: 12px; background: var(--bg-card2); border-radius: 9px; padding: 3px; }
.tabs button { flex: 1; padding: 8px 0; border: none; border-radius: 7px;
  background: transparent; color: var(--text-sub); cursor: pointer; font-size: .85rem; font-family: inherit; font-weight: 500; }
.tabs button.active { background: var(--bg-card); color: var(--text-label); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.tabs button:hover:not(.active) { color: var(--text-label); }
.tabs button:disabled { opacity: .5; cursor: not-allowed; }

/* ---- table ---- */
.tablewrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 7px 12px; text-align: left; white-space: nowrap; }
th { background: var(--bg-card2); color: var(--text-sub); font-weight: 600; font-size: 12px; border-bottom: 1px solid var(--border); }
td { border-bottom: 1px solid var(--border-light); }
tr:hover td { background: var(--bg-list-hover); }

/* ---- rating / badges ---- */
.rbadge { display: inline-block; min-width: 44px; text-align: center; padding: 2px 6px; border-radius: 6px; font-size: 12px; font-weight: 700; }
.rbadge { background: var(--bg-chip); color: var(--text-sub); }
.rbadge.cls1 { background: var(--bg-rating); color: var(--text-code); }
.r1 { background: #bf953f !important; color: #fff !important; }
.r2 { background: #b0b7c0 !important; color: #fff !important; }
.r3 { background: #ad7235 !important; color: #fff !important; }
.r4 { background: var(--bg-chip) !important; color: var(--text-label) !important; }

/* ---- file upload ---- */
.up-area { border: 2px dashed var(--border-dashed); border-radius: 10px; padding: 20px 16px; text-align: center;
  background: var(--bg-upload); cursor: pointer; margin-bottom: 12px; transition: background .15s, border-color .15s; }
.up-area:hover { border-color: var(--accent); background: var(--bg-blue-light); }
.up-area.dragover { border-color: var(--accent); background: var(--bg-blue); }
.up-area .ico { font-size: 32px; }
.up-area .title { font-weight: 600; color: var(--text-upload); }
.up-area .sub { font-size: 12px; color: var(--text-upload-sub); margin-top: 4px; }
.filebar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.filebar .ghost { padding: 6px 14px; border: 1px solid var(--border-ghost); border-radius: 7px; cursor: pointer; font-size: .82rem; font-family: inherit; }
.filebar .ghost:hover { background: var(--bg-card-hover); }
.filebar .ghost.sm { font-size: .78rem; padding: 4px 10px; }
.fb-chips { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; }
.chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 6px; border-radius: 5px; background: var(--bg-chip); color: var(--text-label); }
.chip .del { cursor: pointer; opacity: .6; }
.chip .del:hover { opacity: 1; color: var(--error); font-weight: 700; }
.actionrow { display: flex; align-items: center; gap: 8px; }
.filebtn { background: var(--accent); color: #fff; border: none; padding: 8px 24px; border-radius: 7px; font-size: .85rem; font-family: inherit; cursor: pointer; }
.filebtn:hover { background: var(--accent-hover); }
.filebtn:disabled { opacity: .5; cursor: not-allowed; }
.filebtn.lg { font-size: 1rem; padding: 10px 36px; }

/* ---- ghost / outline ---- */
.ghost { background: transparent; color: var(--text-label); border: 1px solid var(--border-ghost); padding: 6px 14px; border-radius: 7px; cursor: pointer; font-size: .82rem; font-family: inherit; }
.ghost:hover { background: var(--bg-card-hover); }
.ghost.sm { font-size: .78rem; padding: 4px 10px; }
.ghost.danger { color: var(--error); border-color: var(--error); }
.ghost.danger:hover { background: var(--bg-card-hover); }

/* ---- modals ---- */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 200; }
.modal { background: var(--bg-card); border-radius: 12px; padding: 20px; max-width: 600px; width: 90%; max-height: 85vh; overflow-y: auto; box-shadow: 0 8px 30px rgba(0,0,0,.15); }
.modal h2 { margin: 0 0 4px; font-size: 1.1rem; }
.modal p { color: var(--text-muted); margin: 6px 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.modal-rating { width: 460px; }
.rh-block { margin-top: 12px; }
.rh-h { font-size: 12px; font-weight: 600; color: var(--text-modal); margin-bottom: 5px; }
.rh-p { font-size: 12px; color: var(--text-rating); margin: 0 0 6px; line-height: 1.5; }
.rh-f { display: block; background: var(--bg-rating); border: 1px solid var(--border-rating); border-radius: 6px;
  padding: 8px 10px; font-size: 12px; color: var(--text-code); line-height: 1.5; word-break: break-word; }
.rh-factors, .rh-tiers { display: flex; flex-wrap: wrap; gap: 6px; }
.rh-tag { font-size: 11px; padding: 2px 8px; border-radius: 6px; background: var(--bg-chip); color: var(--text-label); }
.rh-tiers .rbadge { font-size: 11px; }
.lang-select { appearance: none; -webkit-appearance: none; border: 1px solid var(--border-ghost); background: var(--bg-card2);
  color: var(--text-label); padding: 6px 28px 6px 10px; border-radius: 7px; font-size: 13px; cursor: pointer;
  font-family: inherit; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' stroke='%2346566f' stroke-width='2' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 6px center; background-size: 14px; }
.lang-select:hover { background-color: var(--bg-card-hover); }

@media (max-width: 768px) {
  .mcards { grid-template-columns: repeat(2, 1fr); }
  .filebar { flex-wrap: wrap; }
  th, td { padding: 5px 8px; font-size: 12px; }
  .rbadge { min-width: 36px; padding: 1px 5px; font-size: 11px; }
  .tabs { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button { flex: none; white-space: nowrap; }
  .colpanel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: calc(100vw - 40px); max-width: 380px; z-index: 200; max-height: 80vh; }
  .collist { max-height: 50vh; }
  .tablewrap { background: linear-gradient(to right, transparent calc(100% - 48px), var(--scroll-fade) 100%), var(--bg-card); }
}
@media (max-width: 480px) {
  .wrap { padding: 10px 8px; }
  .mcards { grid-template-columns: 1fr; gap: 6px; }
  .mc { padding: 6px 10px; }
  .mc .v { font-size: 15px; }
  .up-actions { flex-direction: column; align-items: stretch; }
  .up-actions .filebtn { width: 100%; }
  .filebar { flex-direction: column; align-items: stretch; gap: 6px; }
  .filebar .ghost.sm { width: 100%; }
  .fb-chips { max-height: 80px; overflow-y: auto; }
  .actionrow { flex-direction: column; align-items: stretch; }
  .actionrow .lg { width: 100%; }
  .colpanel { width: calc(100vw - 24px); }
  .collist { max-height: 50vh; }
  .restoolbar { flex-direction: column; }
  .tabs { flex: none; width: 100%; }
  .restoolbar .resactions { width: 100%; gap: 4px; }
  .restoolbar .resactions button { flex: 1; min-width: 0; }
  .modal { width: calc(100vw - 32px); }
  th, td { padding: 4px 5px; font-size: 11px; }
  .rbadge { min-width: 28px; padding: 1px 4px; font-size: 10px; }
  .chip { font-size: 11px; padding: 2px 4px; }
}
.scroll-hint { display: none; }
@media (max-width: 768px) {
  .scroll-hint { display: block; text-align: center; font-size: 11px; color: var(--text-sub); margin: 6px 0 0; padding-bottom: 4px; }
}

/* ----- topbar responsive ----- */
@media (max-width: 768px) {
  .topbar { padding: 6px 10px; gap: 4px; }
  .topbar nav { gap: 2px; }
  .topbar nav button { padding: 5px 8px; font-size: .78rem; }
  .theme-bar { display: none; }
}
@media (max-width: 480px) {
  .topbar { padding: 4px 6px; gap: 2px; height: 40px; }
  .tb-content { padding-top: 46px; }
  .topbar nav button { padding: 4px 6px; font-size: .72rem; }
  .lang-select { font-size: .7rem; padding: 3px 18px 3px 5px; background-size: 10px; }
  .tb-logo { height: 22px; }
  .auth-btn { padding: 4px 8px; font-size: .75rem; }
}
</style>
