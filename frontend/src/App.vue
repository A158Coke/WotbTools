<script setup>
import { ref } from 'vue'
import { useTheme } from './composables/useTheme.js'
import { useError } from './composables/useError.js'
import HomePage from './components/HomePage.vue'
import ReplayPage from './components/ReplayPage.vue'
import LeaderboardPage from './components/LeaderboardPage.vue'
import ProfilePage from './components/ProfilePage.vue'
import BoostPage from './components/BoostPage.vue'
import AdminUsersPage from './components/AdminUsersPage.vue'

const { theme, handleTheme } = useTheme()
const { error: globalError, showError: showGlobalError, close: closeGlobalError } = useError()

const languageOptions = [
  { key: 'zh', label: '中文' },
  { key: 'en', label: 'English' },
  { key: 'ru', label: 'Русский' },
]

const params = new URLSearchParams(window.location.search)
const isHomeHost = window.location.hostname === 'wotbtools.com' || window.location.hostname === 'www.wotbtools.com'
const defaultView = isHomeHost ? 'home' : 'replay'
const viewParam = params.get('view')
const activeTool = ref(['home', 'replay', 'leaderboard', 'profile', 'boost', 'admin-users'].includes(viewParam) ? viewParam : defaultView)

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
      <button :class="{ active: activeTool === 'boost' }" @click="navigate('boost')">{{ $t('app.boost_tab') }}</button>
    </nav>
    <div class="tb-spacer"></div>
    <select class="lang-select" v-model="$i18n.locale" @change="onLangChange">
      <option v-for="l in languageOptions" :key="l.key" :value="l.key">{{ l.label }}</option>
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
    <AdminUsersPage v-else-if="activeTool === 'admin-users'" />
    <ReplayPage v-else />
  </div>

  <!-- Global Error Dialog -->
  <div v-if="showGlobalError && globalError" class="modal-overlay" @click.self="closeGlobalError">
    <div class="modal" style="max-width:480px;">
      <h3>{{ $t('app.global_error_title') }}</h3>
      <p class="error-msg">{{ globalError }}</p>
      <div class="modal-actions">
        <button class="btn-sm" @click="closeGlobalError">{{ $t('app.close') }}</button>
      </div>
    </div>
  </div>
</template>

<style>
:root {
  --bg: #f1f3f0;
  --bg-card: #ffffff;
  --bg-card2: #eef1eb;
  --bg-card-hover: #e4e8de;
  --bg-blue: #e7efe1;
  --bg-blue-light: #f1f6ec;
  --bg-upload: #fbfcf7;
  --bg-elevated: #ffffff;
  --bg-chip: #ece8dd;
  --bg-list-hover: #f6f4ec;
  --bg-rating: #f5efe0;
  --bg-t1: #eef5e8;
  --bg-t2: #f8eee6;
  --text: #1e231f;
  --text-heading: #171b18;
  --text-sub: #72796f;
  --text-muted: #6a7067;
  --text-label: #3e473f;
  --text-upload: #252d27;
  --text-upload-sub: #747d71;
  --text-modal: #2c332d;
  --text-rating: #50574f;
  --text-code: #28312b;
  --border: #d9ded2;
  --border-header: #ced6c7;
  --border-ghost: #cbd3c4;
  --border-dashed: #aeb99f;
  --border-chip: #d3c9b7;
  --border-col: #bdc8b2;
  --border-light: #ecefe7;
  --border-heavy: #b9c3ad;
  --border-warn: #d8aa45;
  --border-tab-active: #d2a43c;
  --border-rating: #e3d5b6;
  --accent: #c98d20;
  --accent-hover: #ad7514;
  --accent-dark: #745014;
  --accent-light: #e4b351;
  --accent-icon: #9c6e18;
  --accent-shadow: rgba(201, 141, 32, .16);
  --accent-text: #17130b;
  --hero-fg-rgb: 247 240 223;
  --surface-shadow: 0 14px 34px rgba(34, 38, 30, .07);
  --hard-shadow: 0 22px 70px rgba(22, 26, 18, .16);
  --error: #b6362e;
  --warn-text: #6f4700;
  --warn-bg: #fff6dc;
  --delete: #a83b34;
  --scroll-fade: #f1f3f0;
}

[data-theme="dark"] {
  --bg: #0f1412;
  --bg-card: #171d1a;
  --bg-card2: #202821;
  --bg-card-hover: #293329;
  --bg-blue: #28311f;
  --bg-blue-light: #202a1d;
  --bg-upload: #141a17;
  --bg-elevated: #1a211c;
  --bg-chip: #28251d;
  --bg-list-hover: #21291f;
  --bg-rating: #2a2417;
  --bg-t1: #1d2a1d;
  --bg-t2: #2d2119;
  --text: #e7ebe2;
  --text-heading: #f4f2e8;
  --text-sub: #98a193;
  --text-muted: #858f81;
  --text-label: #c7d0c0;
  --text-upload: #e0e6da;
  --text-upload-sub: #9aa493;
  --text-modal: #dce3d8;
  --text-rating: #c2cbbd;
  --text-code: #e3e8dc;
  --border: #2d352b;
  --border-header: #37402f;
  --border-ghost: #3b4436;
  --border-dashed: #566246;
  --border-chip: #4a402c;
  --border-col: #4b5742;
  --border-light: #242b24;
  --border-heavy: #566246;
  --border-warn: #9b7626;
  --border-tab-active: #b48224;
  --border-rating: #443923;
  --accent: #d99a25;
  --accent-hover: #f0b33e;
  --accent-dark: #ffd27a;
  --accent-light: #f0b33e;
  --accent-icon: #e5a946;
  --accent-shadow: rgba(217, 154, 37, .22);
  --accent-text: #17130b;
  --hero-fg-rgb: 247 240 223;
  --surface-shadow: 0 14px 34px rgba(0, 0, 0, .24);
  --hard-shadow: 0 22px 70px rgba(0, 0, 0, .42);
  --error: #f06a5f;
  --warn-text: #f5ca76;
  --warn-bg: #2b2110;
  --delete: #d5685f;
  --scroll-fade: #0f1412;
}

* { box-sizing: border-box; }
body { margin: 0; font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', Helvetica, Arial, sans-serif;
  background:
    radial-gradient(circle at 15% -8%, rgba(217, 154, 37, .16), transparent 28%),
    linear-gradient(180deg, rgba(38, 49, 34, .08), transparent 240px),
    var(--bg);
  color: var(--text); }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }
.ic { width: 16px; height: 16px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vertical-align: -3px; }
.up-icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin-bottom: 10px; border-radius: 10px; background: var(--bg-blue-light); color: var(--accent-icon); }
.up-icon .ic { width: 28px; height: 28px; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px 64px; }
h2 { margin: 0 0 10px; font-size: 1.1rem; color: var(--text-heading); }
.tb-content { padding-top: 52px; }
.topbar { position: fixed; top: 0; left: 0; right: 0; z-index: 100; height: 52px;
  display: flex; align-items: center; gap: 8px; padding: 8px 16px;
  background: color-mix(in srgb, var(--bg-card) 92%, transparent);
  border-bottom: 1px solid var(--border-header);
  box-shadow: 0 10px 24px rgba(18, 22, 18, .08);
  backdrop-filter: blur(14px); }
.tb-brand { display: flex; align-items: center; }
.tb-logo { height: 28px; }
.topbar nav { display: flex; gap: 4px; flex: 0 0 auto; min-width: 0; }
.topbar nav button { padding: 6px 12px; border: 1px solid transparent; border-radius: 7px;
  background: transparent; color: var(--text-sub); cursor: pointer; font-size: .85rem; font-family: inherit; white-space: nowrap; }
.topbar nav button.active { background: var(--bg-blue); color: var(--accent-dark); border-color: var(--border-tab-active); font-weight: 700; }
.topbar nav button:hover { background: var(--bg-card-hover); color: var(--text-label); }
.theme-bar { display: flex; gap: 2px; flex: 0 0 auto; align-items: center; white-space: nowrap;
  background: var(--bg-card2); border: 1px solid var(--border-ghost); border-radius: 7px; padding: 2px; }
.theme-bar button { flex: 0 0 auto; padding: 4px 10px; border: none; border-radius: 5px;
  background: transparent; color: var(--text-sub); cursor: pointer; font-size: .73rem; line-height: 1; font-family: inherit; }
.theme-bar button:hover { color: var(--text-label); background: transparent; }
.theme-bar button.active { background: var(--accent); color: var(--accent-text); font-weight: 700; }
.tb-spacer { flex: 1; }
.auth-btn { padding: 6px 14px; border: 1px solid var(--border-ghost); border-radius: 7px;
  background: var(--bg-card2); color: var(--text-label); cursor: pointer; font-size: .82rem; font-family: inherit; white-space: nowrap; }
.auth-btn:hover { background: var(--bg-blue-light); border-color: var(--accent); color: var(--accent-dark); text-decoration: none; }
.tabs { display: flex; gap: 4px; margin-bottom: 12px; background: var(--bg-card2); border-radius: 9px; padding: 3px; }
.tabs button { flex: 1; padding: 8px 0; border: none; border-radius: 7px;
  background: transparent; color: var(--text-sub); cursor: pointer; font-size: .85rem; font-family: inherit; font-weight: 500; }
.tabs button.active { background: var(--bg-card); color: var(--accent-dark); font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.tabs button:hover:not(.active) { color: var(--text-label); }
.tabs button:disabled { opacity: .5; cursor: not-allowed; }
.tablewrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card); box-shadow: var(--surface-shadow); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 7px 12px; text-align: left; white-space: nowrap; }
th { background: var(--bg-card2); color: var(--text-sub); font-weight: 700; font-size: 12px; border-bottom: 1px solid var(--border); }
td { border-bottom: 1px solid var(--border-light); }
tr:hover td { background: var(--bg-list-hover); }
.rbadge { display: inline-block; min-width: 44px; text-align: center; padding: 2px 6px; border-radius: 6px; font-size: 12px; font-weight: 700; background: var(--bg-chip); color: var(--text-sub); }
.rbadge.cls1 { background: var(--bg-rating); color: var(--text-code); }
.r1 { background: #bf953f !important; color: #fff !important; }
.r2 { background: #b0b7c0 !important; color: #fff !important; }
.r3 { background: #ad7235 !important; color: #fff !important; }
.r4 { background: var(--bg-chip) !important; color: var(--text-label) !important; }
.restoolbar { display: flex; align-items: flex-start; gap: 12px; margin: 18px 0; flex-wrap: wrap; position: relative; z-index: 5; }
.restoolbar .tabs { flex: 1; min-width: 0; }
.resactions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.resactions button { white-space: nowrap; }
.tabx { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
  margin-left: 4px; border-radius: 50%; font-size: 12px; font-weight: 700; line-height: 1;
  color: var(--text-sub); background: transparent; cursor: pointer; transition: all .12s; }
.tabx:hover { background: var(--error); color: #fff; }
.mcards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
.mc { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; text-align: center; box-shadow: var(--surface-shadow); }
.mc .k { font-size: .78rem; color: var(--text-sub); margin-bottom: 4px; }
.mc .v { font-size: 1.4rem; font-weight: 700; color: var(--text-heading); font-variant-numeric: tabular-nums; }
.wrap .warn, .wrap .error { padding: 10px 16px; border-radius: 8px; margin-bottom: 12px; font-size: 13px; }
.wrap .warn { background: var(--warn-bg, #fff8e8); border: 1px solid var(--border-warn, #f0d08a); color: var(--warn-text, #8a5200); }
.wrap .error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
.up-area { border: 2px dashed var(--border-dashed); border-radius: 8px; padding: 28px 16px; text-align: center;
  background: var(--bg-upload); cursor: pointer; margin-bottom: 12px; transition: background .15s, border-color .15s; }
.up-area:hover { border-color: var(--accent); background: var(--bg-blue-light); box-shadow: 0 14px 34px var(--accent-shadow); }
.up-area.dragover { border-color: var(--accent); background: var(--bg-blue); }
.up-area .title { font-weight: 600; color: var(--text-upload); font-size: 1rem; margin-bottom: 8px; }
.up-area .sub { font-size: 13px; color: var(--text-upload-sub); }
.uploadhead { margin-bottom: 18px; }
.upload-kicker { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 6px;
  background: var(--bg-rating); color: var(--accent-dark); font-size: 12px; font-weight: 800; }
.uploadhead h1 { margin: 10px 0 8px; color: var(--text-heading); font-size: 1.7rem; line-height: 1.15; letter-spacing: 0; }
.uploadhead p { max-width: 760px; margin: 0; color: var(--text-label); line-height: 1.7; }
.upload-points { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.upload-points span { display: inline-flex; align-items: center; min-height: 28px; padding: 5px 10px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--bg-card); color: var(--text-sub); font-size: 12px; font-weight: 600; }
.uploadcard { min-height: 250px; border: 1.5px dashed var(--border-dashed); border-radius: 8px; padding: 42px 32px;
  text-align: center; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent 45%), var(--bg-upload);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  transition: background .15s, border-color .15s, box-shadow .15s, transform .15s; }
.uploadcard:hover, .uploadcard.dragging { border-color: var(--accent); background: var(--bg-blue-light); box-shadow: 0 14px 34px var(--accent-shadow); }
.uploadcard.dragging { transform: translateY(-1px); }
.up-title { font-weight: 800; color: var(--text-upload); font-size: 1.08rem; }
.up-sub { font-size: 13px; color: var(--text-upload-sub); margin-top: 6px; }
.filebar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.filebar .ghost { padding: 6px 14px; border: 1px solid var(--border-ghost); border-radius: 7px; cursor: pointer; font-size: .82rem; font-family: inherit; }
.filebar .ghost:hover { background: var(--bg-card-hover); }
.filebar .ghost.sm { font-size: .78rem; padding: 4px 10px; }
.fb-chips { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; }
.chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 6px; border-radius: 5px; background: var(--bg-chip); color: var(--text-label); }
.chip .del { cursor: pointer; opacity: .6; }
.chip .del:hover { opacity: 1; color: var(--error); font-weight: 700; }
.actionrow { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
.filebtn { background: var(--accent); color: #fff; border: none; padding: 8px 24px; border-radius: 7px; font-size: .85rem; font-family: inherit; cursor: pointer; }
.filebtn input { display: none; }
.filebtn:hover { background: var(--accent-hover); }
.filebtn:disabled { opacity: .5; cursor: not-allowed; }
.filebtn.lg { font-size: 1rem; padding: 10px 36px; }
.uploadwrap {
  max-width: 980px;
  margin: 0 auto 28px;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: linear-gradient(180deg, var(--bg-elevated), color-mix(in srgb, var(--bg-card2) 46%, var(--bg-elevated)));
  box-shadow: var(--surface-shadow);
}
.up-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ghost { background: transparent; color: var(--text-label); border: 1px solid var(--border-ghost); padding: 6px 14px; border-radius: 7px; cursor: pointer; font-size: .82rem; font-family: inherit; }
.ghost:hover { background: var(--bg-card-hover); }
.ghost.sm { font-size: .78rem; padding: 4px 10px; }
.ghost.danger { color: var(--error); border-color: var(--error); }
.ghost.danger:hover { background: var(--bg-card-hover); }
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
.error-msg { color: var(--error); }
.btn-sm { padding: 4px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text); cursor: pointer; font-size: .8rem; font-family: inherit; }
.btn-sm:hover { background: var(--bg-card-hover); }
.dropdown { position: relative; }
.colpanel {
  position: fixed;
  top: 72px;
  right: 24px;
  z-index: 260;
  width: min(440px, calc(100vw - 32px));
  max-height: min(680px, calc(100vh - 96px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-heavy);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: var(--hard-shadow);
}
.colpanel-head {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 8px;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card2);
}
.cph-title { min-width: 0; color: var(--text-heading); font-size: 13px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.linkbtn { border: 1px solid var(--border-ghost); border-radius: 6px; background: var(--bg-card); color: var(--text-label); padding: 5px 9px; cursor: pointer; font: inherit; font-size: 12px; }
.linkbtn:hover { border-color: var(--accent); color: var(--accent-dark); }
.collist { list-style: none; margin: 0; padding: 8px; overflow-y: auto; max-height: calc(100vh - 166px); }
.collist li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; color: var(--text-label); }
.collist li:hover { background: var(--bg-list-hover); }
.collist li.dragging { opacity: .5; }
.grip { color: var(--text-sub); cursor: grab; font-size: 13px; }
.colitem { min-width: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cat { color: var(--text-sub); font-size: 11px; }
@media (max-width: 768px) {
  .mcards { grid-template-columns: repeat(2, 1fr); }
  .filebar { flex-wrap: wrap; }
  th, td { padding: 5px 8px; font-size: 12px; }
  .rbadge { min-width: 36px; padding: 1px 5px; font-size: 11px; }
  .tabs { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button { flex: none; white-space: nowrap; }
  .colpanel { top: 58px; right: 12px; width: calc(100vw - 24px); max-height: calc(100vh - 72px); }
  .collist { max-height: calc(100vh - 146px); }
  .tablewrap { background: linear-gradient(to right, transparent calc(100% - 48px), var(--scroll-fade) 100%), var(--bg-card); }
}
@media (max-width: 480px) {
  .wrap { padding: 12px 8px 48px; }
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
  .uploadwrap { padding: 14px; }
  .colpanel { top: 48px; right: 8px; width: calc(100vw - 16px); max-height: calc(100vh - 58px); }
  .colpanel-head { grid-template-columns: 1fr 1fr 1fr; }
  .cph-title { grid-column: 1 / -1; }
  .linkbtn { width: 100%; }
  .collist { max-height: calc(100vh - 144px); }
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
@media (max-width: 768px) {
  .topbar { padding: 6px 10px; gap: 4px; }
  .topbar nav { gap: 2px; }
  .topbar nav button { padding: 5px 8px; font-size: .78rem; }
  .uploadwrap { max-width: 100%; }
  .lb-toolbar { flex-wrap: wrap; gap: 6px; }
}
@media (max-width: 480px) {
  .topbar { padding: 4px 6px; gap: 2px; height: 40px; }
  .tb-content { padding-top: 46px; }
  .topbar nav button { padding: 4px 6px; font-size: .72rem; }
  .theme-bar { display: none; }
  .lang-select { font-size: .7rem; padding: 3px 18px 3px 5px; background-size: 10px; }
  .tb-logo { height: 22px; }
  .auth-btn { padding: 4px 8px; font-size: .75rem; }
}
</style>
