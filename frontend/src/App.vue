<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from './composables/useTheme.js'
import * as api from './utils/api.js'
import ReplayPage from './components/ReplayPage.vue'
import LeaderboardPage from './components/LeaderboardPage.vue'

const { t } = useI18n()
const { theme, handleTheme } = useTheme()

const isDesktop = ref(false)
const params = new URLSearchParams(window.location.search)
const activeTool = ref(params.get('view') === 'leaderboard' ? 'leaderboard' : 'replay')

onMounted(async () => {
  try { isDesktop.value = (await api.healthCheck()).desktop } catch { /* 离线模式 */ }
})

function onLangChange(e) { localStorage.setItem('wotb-lang', e.target.value) }
</script>

<template>
  <div class="topbar">
    <a class="tb-brand" href="https://wotbtools.com">
      <img class="tb-logo" src="/wotbtoolslogo.png" alt="WoTBTools">
    </a>
    <nav>
      <button :class="{ active: activeTool === 'replay' }" @click="activeTool = 'replay'">{{ $t('app.replay_tab') }}</button>
      <button v-if="!isDesktop" :class="{ active: activeTool === 'leaderboard' }" @click="activeTool = 'leaderboard'">{{ $t('leaderboard.btn') }}</button>
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
  </div>

  <div class="tb-content">
    <LeaderboardPage v-if="activeTool === 'leaderboard'" />
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
  --delete: #d9534f;
  --r-poor-bg: #FCEBEB; --r-poor-text: #791F1F;
  --r-mid-bg: #F1EFE8; --r-mid-text: #444441;
  --r-good-bg: #EAF3DE; --r-good-text: #27500A;
  --r-great-bg: #E6F1FB; --r-great-text: #0C447C;
  --r-elite-bg: #EEEDFE; --r-elite-text: #3C3489;
  --alive: #3B6D11;
  --dead: #9aa1ad;
  --lang-svg-arrow: %2346566f;
  --grip: #aab;
  --shadow: rgba(0,0,0,.15);
  --shadow-modal: rgba(0,0,0,.2);
  --scroll-fade: rgba(0,0,0,.04);
}
[data-theme="dark"] {
  --bg: #0d1117;
  --bg-card: #161b22;
  --bg-card2: #21262d;
  --bg-card-hover: #30363d;
  --bg-blue: #1a2b4a;
  --bg-blue-light: #162240;
  --bg-upload: #0d1117;
  --bg-chip: #21262d;
  --bg-list-hover: #21262d;
  --bg-rating: #161b22;
  --bg-t1: #162240;
  --bg-t2: #2d1f18;
  --text: #c9d1d9;
  --text-heading: #f0f6fc;
  --text-sub: #8b949e;
  --text-muted: #8b949e;
  --text-label: #8b949e;
  --text-upload: #f0f6fc;
  --text-upload-sub: #8b949e;
  --text-modal: #f0f6fc;
  --text-rating: #8b949e;
  --text-code: #c9d1d9;
  --border: #30363d;
  --border-header: #21262d;
  --border-ghost: #30363d;
  --border-dashed: #30363d;
  --border-chip: #30363d;
  --border-col: #30363d;
  --border-light: #21262d;
  --border-heavy: #30363d;
  --border-warn: #d29922;
  --border-tab-active: #58a6ff;
  --border-rating: #30363d;
  --accent: #58a6ff;
  --accent-hover: #79c0ff;
  --accent-dark: #58a6ff;
  --accent-light: #58a6ff;
  --accent-icon: #58a6ff;
  --error: #f85149;
  --warn-text: #e3b341;
  --warn-bg: #3d2e00;
  --delete: #da3633;
  --r-poor-bg: #3d1f1f; --r-poor-text: #f85149;
  --r-mid-bg: #3d3520; --r-mid-text: #e3b341;
  --r-good-bg: #1f3d1f; --r-good-text: #3fb950;
  --r-great-bg: #1a2b4a; --r-great-text: #58a6ff;
  --r-elite-bg: #2a2250; --r-elite-text: #a371f7;
  --alive: #3fb950;
  --dead: #484f58;
  --lang-svg-arrow: %238b949e;
  --grip: #484f58;
  --shadow: rgba(0,0,0,.3);
  --shadow-modal: rgba(0,0,0,.4);
  --scroll-fade: rgba(0,0,0,.12);
}

body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; color: var(--text); background: var(--bg); transition: background .25s, color .25s; }
.wrap { max-width: 1400px; margin: 0 auto; padding: 16px 20px; }

.topbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  display: flex; align-items: center; gap: 8px;
  padding: 6px 20px; height: 48px;
  background: var(--bg-card); border-bottom: 1px solid var(--border-header);
}
.tb-brand { text-decoration: none; font-size: 15px; font-weight: 700; color: var(--heading); white-space: nowrap }
.tb-brand:hover { color: var(--accent) }
.tb-logo { height: 28px; width: auto; vertical-align: middle; border-radius: 6px }
.topbar nav { display: flex; gap: 4px }
.topbar nav button {
  padding: 5px 14px; border: none; border-radius: 7px; font-family: inherit;
  background: transparent; color: var(--text-muted); font-size: .85rem; cursor: pointer; transition: background .12s, color .12s;
}
.topbar nav button:hover { color: var(--text) }
.topbar nav button.active { background: var(--bg-blue); color: var(--accent-dark); font-weight: 600 }
.tb-spacer { flex: 1 }
.tb-content { padding-top: 56px }

.topbar .theme-bar {
  display: flex; gap: 2px;
  background: var(--bg-card2); border: 1px solid var(--border-ghost);
  border-radius: 7px; padding: 2px;
}
.topbar .theme-bar button {
  padding: 4px 10px; border: none; border-radius: 5px;
  background: transparent; color: var(--text-muted); font-size: .73rem;
  cursor: pointer; transition: background .15s, color .15s; font-family: inherit;
}
.topbar .theme-bar button:hover { color: var(--text) }
.topbar .theme-bar button.active { background: var(--accent); color: #fff; font-weight: 600; }
.topbar .lang-select { font-size: .73rem; padding: 4px 22px 4px 8px; background-size: 12px }

.ic { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round; }
.mcards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 4px 0 12px; }
.mc { background: var(--bg-card2); border-radius: 8px; padding: 9px 13px; }
.mc .k { font-size: 12px; color: var(--text-muted); }
.mc .v { font-size: 18px; font-weight: 600; margin-top: 2px; color: var(--text); }
.rbadge { display: inline-block; min-width: 42px; padding: 1px 7px; border-radius: 6px; font-size: 12px; }
.r-poor { background: var(--r-poor-bg); color: var(--r-poor-text); }
.medal { font-size: 12px; }
.poop { height: 1.15em; width: auto; vertical-align: -0.25em; margin-left: 2px; }
.r-mid { background: var(--r-mid-bg); color: var(--r-mid-text); }
.r-good { background: var(--r-good-bg); color: var(--r-good-text); }
.r-great { background: var(--r-great-bg); color: var(--r-great-text); }
.r-elite { background: var(--r-elite-bg); color: var(--r-elite-text); }
.alive { color: var(--alive); }
.dead { color: var(--dead); }
button, .filebtn { display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 7px 14px; border: 1px solid transparent; background: var(--accent); color: #fff; line-height: 1;
  border-radius: 7px; cursor: pointer; font-size: 13px; transition: background .12s, border-color .12s; }
button:hover:not(:disabled), .filebtn:hover { background: var(--accent-hover); }
button:disabled { opacity: .5; cursor: default; }
.ghost { background: var(--bg-card2); color: var(--text-label); border-color: var(--border-ghost); }
.ghost:hover:not(:disabled), .filebtn.ghost:hover { background: var(--bg-card-hover); }
.filebtn input { display: none; }
.lg { padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 9px; }
.lg .ic { width: 18px; height: 18px; }
.sm { padding: 5px 11px; font-size: 12px; border-radius: 7px; }
.sm .ic { width: 14px; height: 14px; }
.muted { color: var(--text-muted); font-size: 13px; }
.error { color: var(--error); }
.warn { color: var(--warn-text); background: var(--warn-bg); border: 1px solid var(--border-warn); padding: 8px; border-radius: 4px; }
.warn span, .error span { display: inline-block; margin: 2px 8px 2px 0; }
.uploadwrap { margin-bottom: 16px; }
.uploadcard { border: 1.5px dashed var(--border-dashed); background: var(--bg-upload); border-radius: 12px;
  padding: 30px 20px; text-align: center; transition: border-color .12s, background .12s; }
.uploadcard.dragging { border-color: var(--accent); background: var(--bg-blue-light); }
.up-icon { display: inline-flex; align-items: center; justify-content: center; width: 52px; height: 52px;
  border-radius: 50%; background: var(--bg-blue); color: var(--accent-light); margin-bottom: 12px; }
.up-icon .ic { width: 26px; height: 26px; }
.up-title { font-size: 15px; font-weight: 600; color: var(--text-upload); }
.up-sub { font-size: 13px; color: var(--text-upload-sub); margin-top: 4px; }
.up-actions { display: flex; gap: 10px; justify-content: center; margin-top: 16px; }
.filebar { display: flex; align-items: center; gap: 10px; background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 10px; padding: 9px 13px; transition: border-color .12s, background .12s; }
.filebar.dragging { border-color: var(--accent); background: var(--bg-blue-light); }
.fb-ic { width: 18px; height: 18px; color: var(--accent-icon); }
.fb-count { font-size: 13px; font-weight: 600; color: var(--text-upload); flex: none; }
.fb-chips { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; }
.actionrow { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.chip { background: var(--bg-chip); border: 1px solid var(--border-chip); border-radius: 4px; padding: 3px 6px;
  font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.chipx { padding: 0 4px; border: none; background: transparent; color: #8a93a6; font-size: 14px;
  line-height: 1; cursor: pointer; border-radius: 3px; }
.chipx:hover { background: var(--delete); color: #fff; }
.tabx { margin-left: 4px; padding: 0 3px; border-radius: 3px; opacity: .65; }
.tabx:hover { background: var(--delete); color: #fff; opacity: 1; }
.dropdown { position: relative; display: inline-block; }
.colpanel { position: absolute; top: 110%; right: 0; z-index: 50; width: 260px;
  background: var(--bg-card); border: 1px solid var(--border-col); border-radius: 6px;
  box-shadow: 0 6px 24px var(--shadow); padding: 6px 0; }
.colpanel-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 4px 10px 6px; border-bottom: 1px solid var(--border-light); }
.cph-title { flex-basis: 100%; font-size: 12px; color: var(--text-muted); margin-bottom: 2px; }
.linkbtn { background: none; border: none; color: var(--accent); padding: 2px 4px;
  font-size: 12px; cursor: pointer; }
.linkbtn:hover:not(:disabled) { background: none; }
.linkbtn:hover { text-decoration: underline; }
.collist { list-style: none; margin: 0; padding: 4px 0; max-height: 320px; overflow-y: auto; }
.collist li { display: flex; align-items: center; gap: 6px; padding: 3px 10px; }
.collist li:hover { background: var(--bg-list-hover); }
.collist li.dragging { opacity: .4; }
.grip { cursor: grab; color: var(--grip); user-select: none; font-size: 12px; letter-spacing: -2px; }
.colitem { flex: 1; font-size: 13px; display: flex; align-items: center; gap: 6px;
  white-space: nowrap; cursor: default; }
.cat { font-size: 11px; color: var(--text-sub); }
.restoolbar { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; margin: 16px 0 8px; }
.resactions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; margin: 0; }
.tabs button { background: var(--bg-card2); color: var(--text-label); border-color: var(--border-ghost); }
.tabs button:hover:not(:disabled) { background: var(--bg-card-hover); }
.tabs button.active { background: var(--bg-blue); color: var(--accent-dark); border-color: var(--border-tab-active); font-weight: 600; }
.tabs.locked button:disabled { cursor: not-allowed; }
.tablewrap { overflow-x: auto; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; }
table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 13px; }
th, td { padding: 7px 12px; white-space: nowrap; text-align: center;
  border-bottom: 1px solid var(--border-light); font-variant-numeric: tabular-nums; }
th { background: var(--bg-card2); color: var(--text-label); font-weight: 500; cursor: pointer; user-select: none;
  position: sticky; top: 0; border-bottom: 1px solid var(--border-heavy); }
tbody tr:last-child td { border-bottom: none; }
th:last-child, td:last-child { padding-right: 16px; }
tr.t1 td { background: var(--bg-t1); }
tr.t2 td { background: var(--bg-t2); }
th:first-child, td:first-child { position: sticky; left: 0; z-index: 2; }
th:first-child { background: var(--bg-card2); }
td:first-child { background: var(--bg-card); }
tr.t1 td:first-child { background: var(--bg-t1); }
tr.t2 td:first-child { background: var(--bg-t2); }
.closed { padding: 30px; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex;
  align-items: center; justify-content: center; z-index: 100; }
[data-theme="dark"] .modal-mask { background: rgba(0,0,0,.6); }
.modal { background: var(--bg-card); border-radius: 8px; padding: 18px 20px; width: 360px; max-width: 90vw;
  box-shadow: 0 8px 30px var(--shadow-modal); }
.modal-title { font-size: 15px; font-weight: bold; margin: 0 0 8px; color: var(--text-modal); }
.modal-sub { font-size: 12px; color: var(--text-muted); margin: 6px 0 0; }
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
</style>