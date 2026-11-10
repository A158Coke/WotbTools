<script setup>
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch, watchEffect } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { Menu } from 'lucide-vue-next'
import { useAuth } from '../composables/useAuth.js'
import { shouldEnsureBusinessUser, useBusinessUserBootstrap } from '../composables/useBusinessUserBootstrap.js'
import { useConnectivity } from '../composables/useConnectivity.js'
import { useConnectivityNotice } from '../composables/useConnectivityNotice.js'
import { useError } from '../composables/useError.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { provideCreatorAvailability } from '../composables/useCreatorAvailability.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { useOnboarding } from '../composables/useOnboarding.js'
import { useUiProfile } from '../composables/useUiProfile.js'
import { useSiteFeedback } from '../composables/useSiteFeedback.js'
import { useUsageTelemetry } from '../composables/useUsageTelemetry.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { useAndroidUpdate } from '../composables/useAndroidUpdate.js'
import { ANDROID_UPDATE_KEY } from '../shared/androidUpdate.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { FEEDBACK_KEY } from '../shared/feedback.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { OPEN_NAV_DRAWER_KEY, SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { NOTIFICATIONS_PANEL_KEY } from '../shared/notifications.js'
import { notify } from '../composables/useNotifications.js'
import { createShellChrome } from './shellChrome.js'
import { Feature } from './featureCapabilities.js'
import { defaultView, locationForView, viewFromRoute } from './navigation.js'
import AppTopBar from './AppTopBar.vue'
import AppNavDrawer from './AppNavDrawer.vue'
import AppSidebar from './AppSidebar.vue'
import GlobalErrorDialog from './GlobalErrorDialog.vue'
import AppToast from './AppToast.vue'
import AppButton from '../components/AppButton.vue'
import { dismissTransientToasts } from '../composables/useToast.js'
import NotificationPanel from './NotificationPanel.vue'
import ConfirmDialogHost from '../components/ConfirmDialogHost.vue'
import SiteFeedbackDialog from '../components/SiteFeedbackDialog.vue'
import OnboardingHost from '../components/OnboardingHost.vue'
import AndroidUpdatePanel from '../components/AndroidUpdatePanel.vue'
import publicSecurityFilingIcon from '../assets/public-security-filing.png'

const APP_ICP_FILING = '闽ICP备2026036303号-2A'
const isAndroidAppRuntime = isAndroidApp()
const router = useRouter()
const route = useRoute()
useUsageTelemetry(computed(() => viewFromRoute(route)))
const { error: globalError, showError: showGlobalError, close: closeGlobalError } = useError()
const { notice: connectivityNotice } = useConnectivityNotice()
// 外壳形态（design-language §9）：手机竖屏 / 手机横屏用顶栏菜单 + 左侧抽屉；平板 / 桌面用左侧边栏
const { isDrawerShell } = useBreakpoint()
const navDrawerOpen = ref(false)
const topBar = ref(null)
const immersiveMenu = ref(null)
// 3D 全屏 + 播放器工具栏收起（navEligible=false 交还托管）时，兜底菜单若留在全屏元素外，
// 会被浏览器随外壳一起隐藏，抽屉入口不可达；随 fullscreenchange 渲染进当前全屏根
// （与 AppNavDrawer 的 portalTo 同因同修；非全屏时 Teleport disabled 原地渲染，行为不变）。
const fullscreenRoot = ref(typeof document === 'undefined' ? null : document.fullscreenElement)
function onFullscreenChange() { fullscreenRoot.value = document.fullscreenElement }
onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange))
onUnmounted(() => document.removeEventListener('fullscreenchange', onFullscreenChange))
const navOpener = ref(null)
const navReturnFocus = computed(() => navOpener.value ?? topBar.value?.menuButton ?? immersiveMenu.value)
function openNavDrawer(opener) {
  navOpener.value = opener ?? null
  navDrawerOpen.value = true
}
// 本机通知中心：顶栏铃铛（抽屉外壳）与侧边栏底部（平板 / 桌面）共用这一个面板
const notificationsOpen = ref(false)
const notificationOpener = ref(null)
function openNotifications(opener) {
  notificationOpener.value = opener ?? null
  notificationsOpen.value = true
}
provide(NOTIFICATIONS_PANEL_KEY, openNotifications)
watch(isDrawerShell, (drawer) => { if (!drawer) navDrawerOpen.value = false })
// 切换视图时收起上一页的成功 / 提示 toast（警告 / 错误保留），避免遮住新页面的控件
watch(() => viewFromRoute(route), () => dismissTransientToasts())

/**
 * 连通性监听在这里启动一次（进程内单例）：Android 壳走系统 ConnectivityManager（Native Bridge），
 * 浏览器走 navigator.onLine。业务页面不得自行监听 —— 它们只读 capability 门禁的结果。
 */
const { connectivity, start: startConnectivity } = useConnectivity()
// 门禁（唯一判定入口）：重试等交互用它 —— 既弹统一 connectivity notice，又给出布尔结果。
const { requireFeature } = useFeatureGate()
provideCreatorAvailability()
onMounted(() => {
  void startConnectivity()
})

/**
 * 全局业务用户 bootstrap：只要 Keycloak 认证成功并进入 SPA（任意 view —— home /
 * replay / battle-playback / AI Review / HoF / admin / profile），
 * 就在这里 ensure 当前用户的 user_profile。
 *
 * 这里也是唯一触发点：页面不再各自负责「读不到资料 → 自己创建」。
 *
 * 但 ensure 是一次 **backend** 调用，准入必须服从 capability SSOT（`ACCOUNT_PROFILE` 是
 * ONLINE_REQUIRED，见 shouldEnsureBusinessUser）：离线 / 状态未知时**不发请求、不进入 failed、
 * 不显示失败横幅**，本地 UI 照常可用（「离线是受支持的运行模式，不是错误状态」）。恢复在线后
 * 这里会因 connectivity 变化再次求值并自动补一次（`ensure()` 自身的 ready / in-flight 去重保证
 * 不重复请求，也没有任何 retry 循环）。
 */
const { authInitState, authenticated, tokenParsed, authEpoch } = useAuth()
const { failed, ensure, retry } = useBusinessUserBootstrap()

watch([authInitState, authenticated, connectivity, () => tokenParsed.value?.sub], ([state, isLoggedIn, currentConnectivity]) => {
  // Auth generation changes are authoritative; ensure itself deduplicates ready/in-flight work.
  void ensure({
    authInitState: state,
    authenticated: isLoggedIn,
    connectivity: currentConnectivity,
    authEpoch: authEpoch(),
  })
}, { immediate: true })

/**
 * 失败横幅上的「重试」：必须先过 capability 门禁（`ACCOUNT_PROFILE` 是 ONLINE_REQUIRED）。
 *
 * 否则「在线时失败 → 用户断网 → 点重试」会绕过策略再打一次 backend，把离线变成一次新的业务失败。
 * 不允许时统一走 connectivity notice（`requireFeature` 内部弹层），**绝不**用 profile 业务错误冒充。
 */
function retryBusinessBootstrap() {
  const context = {
    authInitState: authInitState.value,
    authenticated: authenticated.value,
    connectivity: connectivity.value,
    authEpoch: authEpoch(),
  }
  if (!shouldEnsureBusinessUser(context)) {
    requireFeature(Feature.ACCOUNT_PROFILE)
    return
  }
  void retry(context)
}

/**
 * 登出 / 会话失效 → 当前运行面的默认落地页（2.1.0 Phase 5.3/5.4）：
 * Web production 回首页；Android 与本地 Web 回回放工作台。浏览器端这一步发生在跳 Keycloak
 * end-session 之前（local-first 已先清本地态）；Android 端页面不导航，这一跳就是它唯一的落点。
 * init 重建期间（authInitState=initializing）的中间态不是登出：不导航。
 */
let previousAuthenticated = authenticated.value
watch(authenticated, (now) => {
  const was = previousAuthenticated
  previousAuthenticated = now
  if (!was || now) return
  if (authInitState.value === 'initializing') return
  navigate(defaultView())
})

function navigate(target) {
  // 目标是 view 字符串或带 query 的完整目的地；两者都归 router（组件不碰 history）
  const destination = router.resolve(
    typeof target === 'string'
      ? locationForView(target, route)
      : { path: route.path, query: { ...route.query, ...target.query } },
  )
  if (destination.fullPath !== route.fullPath) return router.push(destination)
}

provide(NAVIGATE_VIEW_KEY, navigate)
// 沉浸态：需要整屏高度的 feature（手机横屏回放）通过 typed key 申请，外壳不渲染顶栏，
// 并把 --header-block / --header-h 归零（scale.css 是这两个 token 的唯一 owner），预算公式无需改。
const shellChrome = createShellChrome()
provide(SHELL_CHROME_KEY, shellChrome)
provide(OPEN_NAV_DRAWER_KEY, openNavDrawer)
const androidUpdate = useAndroidUpdate({ route, router })
provide(ANDROID_UPDATE_KEY, androidUpdate)
// 新版本可用：记一条本机通知（同一版本只记一次，id 含版本）
watch(() => androidUpdate.showPrompt.value && androidUpdate.snapshot.value?.latestVersionName, (version) => {
  if (!version) return
  notify({ id: `app-update-${version}`, kind: 'app-update', titleKey: 'notifications.appUpdate', bodyKey: 'notifications.appUpdateBody', params: { version }, view: 'more' })
}, { immediate: true })
watchEffect(() => {
  if (shellChrome.immersive.value) document.documentElement.dataset.shellChrome = 'immersive'
  else delete document.documentElement.dataset.shellChrome
})
onUnmounted(() => { delete document.documentElement.dataset.shellChrome })
const onboarding = useOnboarding({
  navigate,
  view: computed(() => viewFromRoute(route)),
  canInvite: computed(() => !showGlobalError.value && !connectivityNotice.value && !failed.value),
})
provide(ONBOARDING_KEY, onboarding.context)
const siteFeedback = useSiteFeedback(route)
const { open: siteFeedbackOpen, pageView: siteFeedbackPage } = siteFeedback
provide(FEEDBACK_KEY, siteFeedback.request)

/**
 * 全站环境背景（design-language §2）：fixed 装饰层先铺 canvas 纯色，等当前主题 /
 * 视口对应的氛围图解码完成后再 .is-ready 淡入，避免背景图阻塞首屏。
 * 主题切换时重新等新图，竖屏 / 横屏切换只更新预载目标（CSS 已同步换图）。
 */
const { uiProfile } = useUiProfile()
const backdropReady = ref(false)
const loadedBackdrops = new Set()
let backdropLoadToken = 0
const portraitBackdropQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(orientation: portrait) and (width < 768px)')
  : null

/**
 * 图片 URL 只从 color.css 的语义 token 读，避免 AppShell 再维护一份季节映射；
 * 主题 / 横竖屏切换时 CSS 已经同步换图，这里只负责按同一个 URL 预解码。
 */
function currentBackdropSource() {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return ''
  const token = portraitBackdropQuery?.matches ? '--theme-backdrop-image-portrait' : '--theme-backdrop-image'
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const match = value.match(/^url\((['"]?)(.*)\1\)$/)
  return match ? match[2] : ''
}

function preloadBackdrop(url) {
  if (!url || typeof Image === 'undefined') {
    backdropReady.value = true
    return
  }
  if (loadedBackdrops.has(url)) {
    backdropReady.value = true
    return
  }
  const token = ++backdropLoadToken
  const image = new Image()
  image.decoding = 'async'
  const finish = (loaded) => {
    if (loaded) loadedBackdrops.add(url)
    // 只让最后一次请求决定可见性，防止快速切换主题时旧图回写把新图盖住。
    if (token === backdropLoadToken) backdropReady.value = true
  }
  image.onload = () => finish(true)
  // 图片 404 / 解码失败时退回 canvas 纯色，不能让装饰层永远停在 opacity: 0。
  image.onerror = () => finish(false)
  image.src = url
}

function syncBackdrop() {
  // 视口横竖切换也会换图：先退回 canvas，等新图解码后再淡入，避免换图瞬间露出半张图。
  backdropReady.value = false
  preloadBackdrop(currentBackdropSource())
}

onMounted(() => {
  syncBackdrop()
  portraitBackdropQuery?.addEventListener?.('change', syncBackdrop)
})
onUnmounted(() => {
  portraitBackdropQuery?.removeEventListener?.('change', syncBackdrop)
})
watch(uiProfile, async () => {
  backdropReady.value = false
  await nextTick()
  syncBackdrop()
})
</script>

<template>
  <div class="app-backdrop" :class="{ 'is-ready': backdropReady }" aria-hidden="true" />
  <AppTopBar
    v-if="isDrawerShell && !shellChrome.immersive.value"
    ref="topBar"
    :nav-open="navDrawerOpen"
    @open-nav="openNavDrawer(null)"
  />
  <AppSidebar v-if="!isDrawerShell" />
  <!-- 沉浸态（手机横屏回放 / 装甲查看器）没有顶栏：左上保留同一个菜单入口打开抽屉 -->
  <Teleport :to="fullscreenRoot ?? 'body'" :disabled="!fullscreenRoot">
    <button
      v-if="isDrawerShell && shellChrome.immersive.value && !shellChrome.navHosted.value"
      ref="immersiveMenu"
      type="button"
      class="immersive-nav"
      :aria-label="$t('nav.openDrawer')"
      :aria-expanded="navDrawerOpen ? 'true' : 'false'"
      aria-haspopup="dialog"
      data-testid="nav-menu"
      @click="openNavDrawer(null)"
    >
      <Menu :size="20" aria-hidden="true" />
    </button>
  </Teleport>
  <AppNavDrawer
    v-if="isDrawerShell"
    :open="navDrawerOpen"
    :return-focus-to="navReturnFocus"
    @close="navDrawerOpen = false"
  />
  <div v-if="failed" class="business-bootstrap-notice" role="alert" data-testid="business-bootstrap-notice">
    <span>{{ $t('bootstrap.profileFailed') }}</span>
    <button type="button" class="business-bootstrap-retry" @click="retryBusinessBootstrap">{{ $t('bootstrap.retry') }}</button>
  </div>
  <aside v-if="androidUpdate.showPrompt.value && !shellChrome.immersive.value" class="android-update-notice" data-testid="android-update-notice" :aria-label="$t('androidUpdate.noticeLabel')">
    <span>{{ $t('androidUpdate.available', { version: androidUpdate.snapshot.value?.latestVersionName }) }}</span>
    <AppButton @click="androidUpdate.open">{{ $t('androidUpdate.view') }}</AppButton>
    <AppButton :disabled="androidUpdate.acting.value" @click="androidUpdate.dismiss">{{ $t('androidUpdate.later') }}</AppButton>
  </aside>
  <RouterView />
  <footer class="app-footer" data-testid="app-footer">
    <div class="app-footer-filings">
      <a
        href="https://beian.miit.gov.cn/"
        :target="isAndroidAppRuntime ? null : '_blank'"
        :rel="isAndroidAppRuntime ? null : 'noopener noreferrer'"
        data-testid="icp-filing-link"
      >{{ isAndroidAppRuntime ? APP_ICP_FILING : $t('home.icpFiling') }}</a>
      <span class="app-footer-separator" aria-hidden="true">|</span>
      <a
        class="app-footer-public-security"
        href="https://beian.mps.gov.cn/#/query/webSearch?code=35018202000555"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="public-security-filing-link"
      >
        <img :src="publicSecurityFilingIcon" alt="" aria-hidden="true">
        <span>{{ $t('home.publicSecurityFiling') }}</span>
      </a>
    </div>
    <p class="app-footer-disclaimer" data-testid="wargaming-disclaimer">{{ $t('home.wargamingDisclaimer') }}</p>
  </footer>
  <GlobalErrorDialog :error="globalError" :visible="showGlobalError" @close="closeGlobalError" />
  <AppToast />
  <NotificationPanel :open="notificationsOpen" :return-focus-to="notificationOpener" @close="notificationsOpen = false" />
  <ConfirmDialogHost />
  <SiteFeedbackDialog v-if="siteFeedbackOpen" :page-view="siteFeedbackPage" @close="siteFeedbackOpen = false" />
  <OnboardingHost :onboarding="onboarding" />
  <AndroidUpdatePanel v-if="androidUpdate.supported.value" :update="androidUpdate" />
</template>

<style scoped>
/* Keep the shared footer at the viewport bottom on short pages without pinning it over content. */
:global(#app) {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

/* 侧边栏是 fixed：内容整体让出 --sidebar-w（抽屉外壳为 0）。没有底部常驻栏（L1）。 */
:global(#app) { padding-inline-start: var(--sidebar-w); }

/* 全站环境背景层（design-language §2）：固定铺满视口、不接收指针事件、永远在内容之后。
   canvas 是最后一层，所以图片未加载 / 加载失败时仍是主题纯色；加载完成后由 JS 加 .is-ready 淡入。
   竖屏手机改用竖向构图，让中上部的坦克车队落在首屏可见区域。 */
.app-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-backdrop);
  pointer-events: none;
  background:
    var(--theme-pattern),
    var(--theme-backdrop),
    var(--theme-backdrop-scrim),
    var(--theme-backdrop-image) var(--theme-backdrop-position) / cover,
    var(--color-canvas);
  opacity: 0;
  transition: opacity 480ms ease;
}

.app-backdrop.is-ready { opacity: 1; }

@media (orientation: portrait) and (width < 768px) {
  .app-backdrop {
    background:
      var(--theme-pattern),
      var(--theme-backdrop),
      var(--theme-backdrop-scrim),
      var(--theme-backdrop-image-portrait) var(--theme-backdrop-position-portrait) / cover,
      var(--color-canvas);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-backdrop { transition: none; }
}

.app-footer {
  margin-top: auto;
}

/* 沉浸态悬浮菜单：玻璃底胶囊，避开刘海与圆角安全区；场景外壳用 --immersive-nav-reserve 让出这一块 */
.immersive-nav {
  position: fixed;
  inset-block-start: max(var(--space-2), env(safe-area-inset-top));
  inset-inline-start: max(var(--space-2), env(safe-area-inset-left));
  z-index: var(--z-header);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: var(--hit-min-comfortable);
  block-size: var(--hit-min-comfortable);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--theme-glass);
  color: var(--color-text-primary);
  cursor: pointer;
}
.immersive-nav:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.android-update-notice {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: calc(var(--header-block) + env(safe-area-inset-top) + var(--space-3)) var(--gutter) var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
}
/* AppButton md 高度（32px）低于移动端 44px 触控目标下限：更新提示条保持 comfortable 命中高度。 */
.android-update-notice .app-button { min-height: var(--hit-min-comfortable); }

/* 提示条已在文档流中让出固定顶栏与安全区：内容区不再重复让出同一高度。 */
:global(#app:has(> .android-update-notice) > .app-main) {
  padding-top: 0;
}

.app-footer a {
  color: var(--color-text-tertiary);
}

.app-footer-disclaimer {
  color: var(--color-text-tertiary);
}

.app-footer-filings {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  min-width: 0;
}

.app-footer-public-security {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.app-footer-public-security img {
  width: var(--space-4);
  height: var(--space-4);
  object-fit: contain;
}

.app-footer-disclaimer {
  flex-basis: 100%;
  margin: 0;
}

@media (width < 768px) {
  .app-footer-filings {
    column-gap: var(--space-2);
  }
}
</style>
