<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useAuth } from './composables/useAuth.js'
import { useError } from './composables/useError.js'
import { useUiProfile } from './composables/useUiProfile.js'
import { isAndroidApp } from './composables/usePlatformBridge.js'
import HomePage from './components/HomePage.vue'
import ReplayWorkspace from './components/ReplayWorkspace.vue'
import HoFPage from './components/HoFPage.vue'
import HoFAdminPage from './components/HoFAdminPage.vue'
import ProfilePage from './components/ProfilePage.vue'
import BoostPage from './components/BoostPage.vue'
import AdminUsersPage from './components/AdminUsersPage.vue'
import VersionPage from './components/VersionPage.vue'
import ContactPage from './components/ContactPage.vue'
import AndroidDownloadPage from './components/AndroidDownloadPage.vue'
// 隐藏 QA 页（?view=playback-qa，仅 wotbtools-admin）：PR4 固定 14 车标签碰撞场景，
// 复用生产 BattlePlayback（异步加载，不拖进普通用户初始 bundle）
const PlaybackQaPage = defineAsyncComponent(() => import('./components/PlaybackQaPage.vue'))
// League Rating V5 算法说明页：异步加载（含 canonical Markdown raw 资源），
// 只有打开文档时才进入 bundle，不影响普通用户初始加载。
const RatingDocsPage = defineAsyncComponent(() => import('./components/RatingDocsPage.vue'))
// 隐藏管理员灰度页（?view=rating-v2）：复用 Processing Job，不进入普通用户初始 bundle 或导航。
const RatingV2AdminPage = defineAsyncComponent(() => import('./components/RatingV2AdminPage.vue'))

const { initPromise, login, logout, isAuthenticated, userName, tokenParsed } = useAuth()
const { error: globalError, showError: showGlobalError, close: closeGlobalError } = useError()
const { uiProfile, setUiProfile } = useUiProfile()

const languageOptions = [
  { key: 'zh', label: '中文' },
  { key: 'en', label: 'English' },
  { key: 'ru', label: 'Русский' },
]

const params = new URLSearchParams(window.location.search)
const isHomeHost = window.location.hostname === 'wotbtools.com' || window.location.hostname === 'www.wotbtools.com'
const defaultView = isHomeHost ? 'home' : 'replay'
const rawViewParam = params.get('view') ?? (window.location.pathname === '/download/android' ? 'android' : null)
// 旧书签兼容：单一来源别名映射（leaderboard → hof；extended → replay；
// reconstruction → battle-playback），
// 一次轻量 replaceState 重定向为 canonical view，不建第二套 Dataset pipeline。
const LEGACY_VIEW_ALIASES = Object.freeze({ leaderboard: 'hof', extended: 'replay', reconstruction: 'battle-playback' })
const canonicalView = LEGACY_VIEW_ALIASES[rawViewParam] ?? rawViewParam
if (canonicalView !== rawViewParam) {
  const url = new URL(window.location.href)
  url.searchParams.set('view', canonicalView)
  window.history.replaceState({}, '', url.toString())
}
const viewParam = canonicalView
const ALLOWED_VIEWS = [
  'home', 'replay', 'hof', 'hof-admin',
  'profile', 'boost', 'admin-users', 'version', 'contact',
  'ai-review', 'battle-playback', 'playback-qa', 'rating-docs', 'rating-v2',
  'android',
]
const activeTool = ref(ALLOWED_VIEWS.includes(viewParam) ? viewParam : defaultView)

// 视图映射 + KeepAlive：解析页保留结果状态；AI/战局能力页按需独立挂载。
const VIEW_COMPONENTS = {
  home: HomePage,
  // 三个 Replay 能力 URL 映射到同一个 Workspace；仅 activeCapability 不同。
  replay: ReplayWorkspace,
  'ai-review': ReplayWorkspace,
  'battle-playback': ReplayWorkspace,
  hof: HoFPage,
  'hof-admin': HoFAdminPage,
  profile: ProfilePage,
  boost: BoostPage,
  'admin-users': AdminUsersPage,
  version: VersionPage,
  contact: ContactPage,
  android: AndroidDownloadPage,
  'playback-qa': PlaybackQaPage,
  'rating-docs': RatingDocsPage,
  'rating-v2': RatingV2AdminPage,
}
const currentView = computed(() => VIEW_COMPONENTS[activeTool.value] || ReplayWorkspace)

/** ReplayWorkspace 初始能力（由 view 派生，不做三套页面对应）。 */
const replayInitialCapability = computed(() => {
  if (activeTool.value === 'ai-review') return 'ai'
  if (activeTool.value === 'battle-playback') return 'playback'
  return 'data'
})

function navigate(view) {
  // 相同 view 不重复 push，避免 Back/Forward 出现重复历史条目。
  if (view === activeTool.value) return
  activeTool.value = view
  const url = new URL(window.location.href)
  if (view === 'home') url.searchParams.delete('view')
  else url.searchParams.set('view', view)
  // pushState 让 Replay → AI → Playback 的可切换 tab 形成可 Back/Forward 的 history；
  // popstate 回来时仅同步 activeTool（currentView/initial-capability 随之更新），
  // ReplayWorkspace 经 KeepAlive 保持 selection / Processing Job 不丢。
  window.history.pushState({ view }, '', url.toString())
}

/** 从当前 URL 解析 view（处理 popstate 恢复）。 */
function viewFromLocation() {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('view') ?? (window.location.pathname === '/download/android' ? 'android' : null)
  const canonical = LEGACY_VIEW_ALIASES[raw] ?? raw
  return ALLOWED_VIEWS.includes(canonical) ? canonical : defaultView
}

function onPopState() {
  activeTool.value = viewFromLocation()
}
// 注入登录态与 login：AI 复盘 / 战局重建能力页需登录。
provide('isAuthenticated', isAuthenticated)
provide('login', login)
// 供 ReplayWorkspace 判断"Keycloak 是否已初始化"：在 init 完成前不得把未初始化误判为未登录，
// 否则已有 SSO/session 的用户会在 Workspace 挂载时被无条件 kc.login() 打断。
provide('authInit', initPromise)
// 跨视图导航注入：ReplayPage 的「算法说明」入口跳转 rating-docs 页使用。
provide('navigate', navigate)

function onLangChange(e) { localStorage.setItem('wotb-lang', e.target.value) }

const userMenuOpen = ref(false)
const userMenuPos = ref({ top: 0, right: 16 })
const userMenuTrigger = ref(null)
const userMenuPanelEl = ref(null)
const isAdmin = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles || []
  return roles.includes('wotbtools-admin')
})
const isHofAdmin = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles || []
  return roles.includes('HoF-admin') || roles.includes('wotbtools-admin')
})
// 下载 Android 版 feature flag：仅 wotbtools-admin 可见（HomePage 经 inject 读取）。
provide('isAdmin', isAdmin)
// 菜单面板经 Teleport 挂到 body，用 fixed 定位对齐触发按钮下方：
// 不受 .topbar overflow-x:auto 裁切，也不撑高顶栏（移动端横向滚动保留）。
function toggleUserMenu() {
  if (userMenuOpen.value) { closeUserMenu(); return }
  const el = userMenuTrigger.value
  if (el) {
    const rect = el.getBoundingClientRect()
    userMenuPos.value = {
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right)
    }
  }
  userMenuOpen.value = true
}
function closeUserMenu() { userMenuOpen.value = false }
// 点击面板内部不关闭（go/handleLogin 等自行关闭）；点击外部关闭。
function onDocClick(e) {
  if (!userMenuOpen.value) return
  if (userMenuTrigger.value?.contains(e.target)) return
  if (userMenuPanelEl.value?.contains(e.target)) return
  closeUserMenu()
}
function onDocKeydown(e) {
  if (e.key === 'Escape' && userMenuOpen.value) closeUserMenu()
}
function handleLogin() { closeUserMenu(); login('profile') }
function handleLogout() { closeUserMenu(); logout() }
function go(view) { closeUserMenu(); navigate(view) }
onMounted(() => {
  initPromise.catch(() => {})
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKeydown)
  window.addEventListener('popstate', onPopState)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('popstate', onPopState)
})
</script>

<template>
  <div class="topbar">
    <a class="tb-brand" href="https://wotbtools.com">
      <img class="tb-logo" src="/wotbtoolslogo.png" alt="WoTBTools">
    </a>
    <nav>
      <button v-if="isHomeHost" :class="{ active: activeTool === 'home' }" @click="navigate('home')">{{ $t('profile.home') }}</button>
      <!-- Replay Workspace 单入口：data/AI/回放三能力由 Workspace 内部 tab 切换（删重复导航）。
           ?view=ai-review|battle-playback 深链仍由 initialCapability 落地到对应能力 tab。 -->
      <button :class="{ active: ['replay', 'ai-review', 'battle-playback'].includes(activeTool) }" @click="navigate('replay')">{{ $t('home.replayParse') }}</button>
      <button :class="{ active: activeTool === 'hof' }" @click="navigate('hof')">{{ $t('hof.btn') }}</button>
      <button :class="{ active: activeTool === 'boost' }" @click="navigate('boost')">{{ $t('app.boost_tab') }}</button>
    </nav>
    <div class="tb-spacer"></div>
    <select class="lang-select" v-model="$i18n.locale" @change="onLangChange">
      <option v-for="l in languageOptions" :key="l.key" :value="l.key">{{ l.label }}</option>
    </select>
    <!-- 下载 Android 版：feature flag，仅 wotbtools-admin 可见，主页右上角。
         Android App 内隐藏（计划 §20）：Native WebView 中不展示「下载 Android 版」。 -->
    <button v-if="!isAndroidApp() && activeTool === 'home'" class="auth-btn ghost android-download-btn" @click="go('android')" :title="$t('android.nav')">{{ $t('android.nav') }}</button>
    <div class="dropdown user-menu">
      <button ref="userMenuTrigger" class="auth-btn ghost user-menu-trigger" @click="toggleUserMenu" :aria-expanded="userMenuOpen" :aria-haspopup="true">
        {{ isAuthenticated() ? userName() : $t('app.login') }}
        <span class="caret">▼</span>
      </button>
      <!-- Teleport 到 body：fixed 定位在触发按钮下方，脱离 .topbar overflow 裁切 -->
      <Teleport to="body">
        <div v-if="userMenuOpen" ref="userMenuPanelEl" class="user-menu-panel" :style="{ top: userMenuPos.top + 'px', right: userMenuPos.right + 'px' }" role="menu">
            <div class="user-menu-section" :aria-label="$t('uiProfile.title')">
              <div class="user-menu-section-title">{{ $t('uiProfile.title') }}</div>
              <div class="ui-profile-segmented" role="group" :aria-label="$t('uiProfile.title')">
                <button class="ui-profile-option" :class="{ active: uiProfile === 'classic' }" :aria-pressed="uiProfile === 'classic'" @click="setUiProfile('classic')">{{ $t('uiProfile.classic') }}</button>
                <button class="ui-profile-option" :class="{ active: uiProfile === 'showcase' }" :aria-pressed="uiProfile === 'showcase'" @click="setUiProfile('showcase')">{{ $t('uiProfile.showcase') }}</button>
              </div>
            </div>
            <div class="user-menu-divider"></div>

          <template v-if="isAuthenticated()">
            <button class="user-menu-item" role="menuitem" @click="go('profile')">{{ $t('app.profile') }}</button>
            <button v-if="isAdmin" class="user-menu-item" role="menuitem" @click="go('admin-users')">{{ $t('admin.title') }}</button>
            <button v-if="isHofAdmin" class="user-menu-item" role="menuitem" @click="go('hof-admin')">{{ $t('hofAdmin.cardTitle') }}</button>
            <button class="user-menu-item" role="menuitem" @click="go('version')">{{ $t('version.btn') }}</button>
            <button v-if="!isAndroidApp()" class="user-menu-item" role="menuitem" @click="go('android')">{{ $t('android.nav') }}</button>
            <button class="user-menu-item" role="menuitem" @click="go('contact')">{{ $t('contact.nav') }}</button>
            <a class="user-menu-item" role="menuitem" href="https://github.com/A158Coke/WotbTools/issues/new" target="_blank" rel="noopener">{{ $t('app.feedback') }}</a>
            <button class="user-menu-item danger" role="menuitem" @click="handleLogout">{{ $t('profile.logout') }}</button>
          </template>
          <template v-else>
            <button class="user-menu-item" role="menuitem" @click="handleLogin">{{ $t('app.login') }}</button>
            <button class="user-menu-item" role="menuitem" @click="go('version')">{{ $t('version.btn') }}</button>
            <button class="user-menu-item" role="menuitem" @click="go('contact')">{{ $t('contact.nav') }}</button>
            <a class="user-menu-item" role="menuitem" href="https://github.com/A158Coke/WotbTools/issues/new" target="_blank" rel="noopener">{{ $t('app.feedback') }}</a>
          </template>
        </div>
      </Teleport>
    </div>
  </div>

  <div class="tb-content">
    <!-- ReplayWorkspace 保持存活：打开文档/其他页面后返回不丢已解析结果、selection 与 active capability。 -->
    <KeepAlive :include="['ReplayWorkspace']">
      <component :is="currentView" :initial-capability="replayInitialCapability" />
    </KeepAlive>
  </div>

  <!-- Global Error Dialog -->
  <div v-if="showGlobalError && globalError" class="modal-overlay" @click.self="closeGlobalError">
    <div class="modal global-error-modal">
      <h3>{{ $t('app.global_error_title') }}</h3>
      <p class="error-msg">{{ globalError }}</p>
      <div class="modal-actions">
        <button class="btn-sm" @click="closeGlobalError">{{ $t('app.close') }}</button>
      </div>
    </div>
  </div>
</template>

<style>
/* V2: Design Tokens 已外移至 src/styles/tokens.css（单一事实源）；此处仅保留组件/全局样式。 */

* { box-sizing: border-box; }
body { margin: 0; font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', Helvetica, Arial, sans-serif;
  background:
    linear-gradient(180deg, rgba(38, 49, 34, .10), transparent 260px),
    var(--bg);
  color: var(--text); }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }
button, input, select, textarea { font-family: inherit; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
}
.ic { width: 16px; height: 16px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vertical-align: -3px; }
.up-icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin-bottom: 10px; border-radius: 10px; background: var(--bg-blue-light); color: var(--accent-icon); }
.up-icon .ic { width: 28px; height: 28px; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px 64px; }
h2 { margin: 0 0 10px; font-size: 1.1rem; color: var(--text-heading); }
.tb-content { padding-top: var(--topbar-h); }
.topbar { position: fixed; top: 0; left: 0; right: 0; z-index: 100; height: var(--topbar-h);
  display: flex; align-items: center; gap: 8px; padding: 8px 16px;
  background: color-mix(in srgb, var(--bg-card) 92%, transparent);
  border-bottom: 1px solid var(--border-header);
  box-shadow: 0 10px 24px rgba(18, 22, 18, .08);
  backdrop-filter: blur(14px);
  overflow-x: auto; scrollbar-width: none; }
.topbar::-webkit-scrollbar { display: none; }
.tb-brand { display: flex; align-items: center; }
.tb-logo { height: 28px; }
.topbar nav { display: flex; gap: 4px; flex: 0 0 auto; min-width: 0; }
.topbar nav button { padding: 6px 12px; border: 1px solid transparent; border-radius: 7px;
  background: transparent; color: var(--text-sub); cursor: pointer; font-size: .85rem; font-family: inherit; white-space: nowrap; }
.topbar nav button.active { background: var(--bg-blue); color: var(--accent-dark); border-color: var(--border-tab-active); font-weight: 700; }
.topbar nav button:hover { background: var(--bg-card-hover); color: var(--text-label); }
.tb-spacer { flex: 1; }
.auth-btn { padding: 6px 14px; border: 1px solid var(--border-ghost); border-radius: 7px;
  background: var(--bg-card2); color: var(--text-label); cursor: pointer; font-size: .82rem; font-family: inherit; white-space: nowrap; }
.auth-btn:hover { background: var(--bg-blue-light); border-color: var(--accent); color: var(--accent-dark); text-decoration: none; }
.auth-btn.active { background: var(--bg-blue); border-color: var(--accent); color: var(--accent-dark); font-weight: 700; }
.user-menu { display: flex; align-items: center; }
.user-menu-trigger { display: inline-flex; align-items: center; gap: 6px; }
.user-menu-trigger .caret { font-size: 10px; opacity: .7; }
.user-menu-panel {
  position: fixed;
  z-index: 220;
  min-width: 200px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg-elevated);
  box-shadow: var(--hard-shadow);
}
.user-menu-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-label);
  text-align: left;
  font-size: .85rem;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  text-decoration: none;
}
.user-menu-item:hover { background: var(--bg-list-hover); color: var(--text-heading); text-decoration: none; }
.user-menu-item.danger { color: var(--error); }
.user-menu-item.danger:hover { background: var(--status-err-bg); color: var(--status-err-fg); }
.user-menu-section { padding: 2px 4px 0; }
.user-menu-section-title { font-size: .7rem; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); margin: 4px 8px 6px; }
.user-menu-divider { margin: 4px; border-top: 1px solid var(--border); }
.ui-profile-segmented { display: flex; gap: 3px; margin: 0 4px 6px; padding: 3px; background: var(--bg-card2); border: 1px solid var(--border); border-radius: 7px; }
.ui-profile-option { flex: 1; padding: 6px 8px; border: 0; border-radius: 5px; background: transparent; color: var(--text-sub); font-size: .82rem; font-family: inherit; cursor: pointer; }
.ui-profile-option:hover { color: var(--text-heading); }
.ui-profile-option.active { background: var(--bg-elevated); color: var(--text-heading); box-shadow: inset 0 0 0 1px var(--border-header); }
.ui-profile-option:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
.tabs { display: flex; gap: 4px; margin-bottom: 12px; background: rgba(13,18,22,.92); border: 1px solid rgba(58,69,76,.5); border-radius: 9px; padding: 3px; }
.tabs button { flex: 1; padding: 8px 0; border: none; border-radius: 7px;
  background: transparent; color: #b5b2aa; cursor: pointer; font-size: .85rem; font-family: inherit; font-weight: 500; }
.tabs button.active { background: rgba(217,143,24,.16); color: #f0aa30; font-weight: 700; box-shadow: none; }
.tabs button:hover:not(.active) { color: #e0ddd4; }
.tabs button:disabled { opacity: .5; cursor: not-allowed; }
.tablewrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card); box-shadow: var(--surface-shadow); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 7px 12px; text-align: left; white-space: nowrap; }
th { background: var(--bg-card2); color: var(--text-sub); font-weight: 700; font-size: 12px; border-bottom: 1px solid var(--border); }
td { border-bottom: 1px solid var(--border-light); }
tbody tr.t1 td { background: color-mix(in srgb, var(--bg-t1) 64%, var(--bg-card)); }
tbody tr.t2 td { background: color-mix(in srgb, var(--bg-t2) 64%, var(--bg-card)); }
tr:hover td { background: var(--bg-list-hover); }
.alive, .dead { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 700; }
.alive { background: var(--status-ok-bg); color: var(--status-ok-fg); }
.dead { background: var(--status-err-bg); color: var(--status-err-fg); }
.restoolbar { display: flex; align-items: flex-start; gap: 12px; margin: 18px 0; flex-wrap: wrap; position: relative; z-index: 5; }
.restoolbar .tabs { flex: 1; min-width: 0; }
.resactions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.resactions button { white-space: nowrap; }
.tabx { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
  margin-left: 4px; border-radius: 50%; font-size: 12px; font-weight: 700; line-height: 1;
  color: var(--text-sub); background: transparent; cursor: pointer; transition: all .12s; }
.tabx:hover { background: var(--error); color: var(--danger-solid-fg); }
.mcards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
.mc { min-width: 0; background: rgba(16,22,26,.94); border: 1px solid rgba(58,69,76,.55); border-radius: 8px; padding: 14px 16px; text-align: center; box-shadow: var(--surface-shadow); }
.mc .k { font-size: .78rem; color: #a3a6a0; margin-bottom: 4px; }
.mc .v { font-size: 1.4rem; font-weight: 700; color: #f6f1e7; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
/* 页面级提示条（V2）：不依赖 .wrap 容器，任何 Layout Primitive 下均可复用。 */
.warn, .error { display: block; padding: 10px 16px; border-radius: 8px; margin-bottom: 12px; font-size: 13px; line-height: 1.55; }
.warn { background: var(--warn-bg); border: 1px solid var(--border-warn); color: var(--warn-text); }
.error { background: var(--status-err-bg); border: 1px solid color-mix(in srgb, var(--error) 34%, var(--border)); color: var(--status-err-fg); }
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
.uploadcard { min-height: 250px; border: 1.5px dashed rgba(110,124,132,.7); border-radius: 8px; padding: 42px 32px;
  text-align: center; background: linear-gradient(135deg, rgba(10,17,20,.92), rgba(7,12,15,.96));
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  transition: background .15s, border-color .15s, box-shadow .15s, transform .15s; }
.uploadcard:hover, .uploadcard.dragging { border-color: var(--accent); background: var(--bg-blue-light); box-shadow: 0 14px 34px var(--accent-shadow); }
.uploadcard.dragging { transform: translateY(-1px); }
.up-title { font-weight: 800; color: var(--text-upload); font-size: 1.08rem; }
.up-sub { font-size: 13px; color: var(--text-upload-sub); margin-top: 6px; }
.filebar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; padding: 12px; border: 1px solid #39444a; border-radius: 8px; background: rgba(13,18,22,.92); box-shadow: var(--surface-shadow); }
.fb-summary { display: flex; align-items: center; gap: 10px; min-width: 180px; color: #c9c5bb; }
.fb-summary strong { display: block; font-size: 13px; color: #f2ede3; }
.fb-count { display: block; margin-top: 2px; font-size: 12px; color: #9aa09c; }
.fb-ic { color: var(--accent-icon); }
.filebar .ghost { padding: 6px 14px; border: 1px solid var(--border-ghost); border-radius: 7px; cursor: pointer; font-size: .82rem; font-family: inherit; }
.filebar .ghost:hover { background: var(--bg-card-hover); }
.filebar .ghost.sm { font-size: .78rem; padding: 4px 10px; }
.fb-chips { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; }
.chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 6px; border-radius: 5px; background: var(--bg-chip); color: var(--text-label); }
.chipx { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: none; border-radius: 50%; background: transparent; color: var(--text-sub); cursor: pointer; font-size: 13px; line-height: 1; }
.chipx:hover { background: var(--status-err-bg); color: var(--status-err-fg); }
.actionrow { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
.actionrow .lg { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 9px 24px; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: var(--accent-text); font-size: .95rem; font-weight: 800; cursor: pointer; }
.actionrow .lg:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
.actionrow .lg:disabled { opacity: .55; cursor: not-allowed; }
.filebtn { background: var(--accent); color: var(--accent-text); border: none; padding: 8px 24px; border-radius: 7px; font-size: .85rem; font-family: inherit; cursor: pointer; font-weight: 700; }
.filebtn input { display: none; }
.filebtn:hover { background: var(--accent-hover); }
.filebtn:disabled { opacity: .5; cursor: not-allowed; }
.filebtn.lg { font-size: 1rem; padding: 10px 36px; }
.uploadwrap {
  max-width: 980px;
  margin: 0 auto 28px;
  padding: 24px;
  border: 1px solid #39444a;
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(19,26,30,.96), rgba(13,18,21,.94));
  box-shadow: var(--surface-shadow);
}
.up-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ghost { background: transparent; color: var(--text-label); border: 1px solid var(--border-ghost); padding: 6px 14px; border-radius: 7px; cursor: pointer; font-size: .82rem; font-family: inherit; }
.ghost:hover { background: var(--bg-card-hover); }
.ghost.sm { font-size: .78rem; padding: 4px 10px; }
.ghost.danger { color: var(--error); border-color: var(--error); }
.ghost.danger:hover { background: var(--bg-card-hover); }
.modal-overlay, .modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 200; }
.modal { background: var(--bg-card); border-radius: 12px; padding: 20px; max-width: 600px; width: 90%; max-height: 85vh; overflow-y: auto; box-shadow: 0 8px 30px rgba(0,0,0,.15); }
.global-error-modal { max-width: 480px; }
.modal h2 { margin: 0 0 4px; font-size: 1.1rem; }
.modal p { color: var(--text-muted); margin: 6px 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
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
  border: 1px solid #39444a;
  border-radius: 8px;
  background: rgba(15, 21, 25, .98);
  box-shadow: var(--hard-shadow);
}
.colpanel-head {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 8px;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid #263136;
  background: #171e22;
}
.cph-title { min-width: 0; color: #f2ede3; font-size: 13px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.linkbtn { border: 1px solid #39444a; border-radius: 6px; background: #151d21; color: #d7d3ca; padding: 5px 9px; cursor: pointer; font: inherit; font-size: 12px; }
.linkbtn:hover { border-color: var(--accent); color: #f0a42b; }
.collist { list-style: none; margin: 0; padding: 8px; overflow-y: auto; max-height: calc(100vh - 166px); }
.collist li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; color: #c9c5bb; }
.collist li:hover { background: #1c262b; }
.collist li.dragging { opacity: .5; }
.grip { color: var(--text-sub); cursor: grab; font-size: 13px; }
.colitem { min-width: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cat { color: #9aa09c; font-size: 11px; }
@media (max-width: 768px) {
  .mcards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filebar { flex-wrap: wrap; }
  th, td { padding: 5px 8px; font-size: 12px; }
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
  .chip { font-size: 11px; padding: 2px 4px; }
}
.scroll-hint { display: none; }
@media (max-width: 1080px) {
  .topbar { position: sticky; height: auto; padding: 8px 10px; gap: 6px; flex-wrap: wrap; }
  .tb-content { padding-top: 0; }
  .tb-spacer { display: none; }
  .topbar nav { order: 3; width: 100%; gap: 2px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .topbar nav::-webkit-scrollbar { display: none; }
}
@media (max-width: 768px) {
  .scroll-hint { display: block; text-align: center; font-size: 11px; color: var(--text-sub); margin: 6px 0 0; padding-bottom: 4px; }
}
@media (max-width: 768px) {
  .topbar { position: sticky; height: auto; padding: 8px 10px; gap: 6px; flex-wrap: wrap; }
  .tb-content { padding-top: 0; }
  .tb-spacer { display: none; }
  .topbar nav { order: 3; width: 100%; gap: 2px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .topbar nav::-webkit-scrollbar { display: none; }
  .topbar nav button { padding: 5px 8px; font-size: .78rem; }
  .uploadwrap { max-width: 100%; }
  .lb-toolbar { flex-wrap: wrap; gap: 6px; }
}
@media (max-width: 480px) {
  .topbar { padding: 6px; gap: 4px; }
  .tb-content { padding-top: 0; }
  .topbar nav button { padding: 4px 6px; font-size: .72rem; }
  .lang-select { font-size: .7rem; padding: 3px 18px 3px 5px; background-size: 10px; }
  .tb-logo { height: 22px; }
  .auth-btn { padding: 4px 8px; font-size: .75rem; }
}
</style>
