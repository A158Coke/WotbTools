<script setup>
import { computed, onMounted, onUnmounted, provide, ref, watch, watchEffect } from 'vue'
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
import { provideHofPendingCount } from '../composables/useHofPendingCount.js'
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
const { isDrawerShell } = useBreakpoint()
const navDrawerOpen = ref(false)
provideHofPendingCount(computed(() => viewFromRoute(route)), navDrawerOpen, async signal => {
  const { getHofPendingTotals } = await import('../api/hall-of-fame.js')
  return getHofPendingTotals(signal)
})
const topBar = ref(null)
const immersiveMenu = ref(null)
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
const notificationsOpen = ref(false)
const notificationOpener = ref(null)
function openNotifications(opener) {
  notificationOpener.value = opener ?? null
  notificationsOpen.value = true
}
provide(NOTIFICATIONS_PANEL_KEY, openNotifications)
watch(isDrawerShell, (drawer) => { if (!drawer) navDrawerOpen.value = false })
watch(() => viewFromRoute(route), () => dismissTransientToasts())

const { connectivity, start: startConnectivity } = useConnectivity()
const { requireFeature } = useFeatureGate()
provideCreatorAvailability()
onMounted(() => {
  void startConnectivity()
})

const { authInitState, authenticated, tokenParsed, authEpoch } = useAuth()
const { failed, ensure, retry } = useBusinessUserBootstrap()

watch([authInitState, authenticated, connectivity, () => tokenParsed.value?.sub], ([state, isLoggedIn, currentConnectivity]) => {
  void ensure({
    authInitState: state,
    authenticated: isLoggedIn,
    connectivity: currentConnectivity,
    authEpoch: authEpoch(),
  })
}, { immediate: true })

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

let previousAuthenticated = authenticated.value
watch(authenticated, (now) => {
  const was = previousAuthenticated
  previousAuthenticated = now
  if (!was || now) return
  if (authInitState.value === 'initializing') return
  navigate(defaultView())
})

function navigate(target) {
  const destination = router.resolve(
    typeof target === 'string'
      ? locationForView(target, route)
      : { path: route.path, query: { ...route.query, ...target.query } },
  )
  if (destination.fullPath !== route.fullPath) return router.push(destination)
}

provide(NAVIGATE_VIEW_KEY, navigate)
const shellChrome = createShellChrome()
provide(SHELL_CHROME_KEY, shellChrome)
provide(OPEN_NAV_DRAWER_KEY, openNavDrawer)
const androidUpdate = useAndroidUpdate({ route, router })
provide(ANDROID_UPDATE_KEY, androidUpdate)
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

const { uiProfile } = useUiProfile()
const backdropReady = ref(false)
let backdropLoadToken = 0
const portraitBackdropQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(orientation: portrait) and (width < 768px)')
  : null

function currentBackdropSource() {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return ''
  const token = portraitBackdropQuery?.matches ? '--theme-backdrop-image-portrait' : '--theme-backdrop-image'
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const match = value.match(/^url\((['"]?)(.*)\1\)$/)
  return match ? match[2] : ''
}

async function syncBackdrop() {
  const token = ++backdropLoadToken
  const url = currentBackdropSource()
  backdropReady.value = !url
  if (backdropReady.value || typeof Image === 'undefined') return

  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try {
    await image.decode()
    if (token === backdropLoadToken) backdropReady.value = true
  } catch {
    // Keep the canvas color when the selected image cannot be decoded.
  }
}

onMounted(() => {
  syncBackdrop()
  portraitBackdropQuery?.addEventListener?.('change', syncBackdrop)
})
onUnmounted(() => {
  ++backdropLoadToken
  portraitBackdropQuery?.removeEventListener?.('change', syncBackdrop)
})
watch(uiProfile, syncBackdrop, { flush: 'post' })
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
  <Teleport :to="fullscreenRoot ?? 'body'" :disabled="!fullscreenRoot">
    <button
      v-if="shellChrome.immersive.value && !shellChrome.navHosted.value"
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
    v-if="isDrawerShell || shellChrome.immersive.value"
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
:global(#app) {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

:global(#app) { padding-inline-start: var(--sidebar-w); }

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
}

.app-backdrop.is-ready { opacity: 1; transition: opacity var(--duration-slow) var(--ease-standard); }

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
  .app-backdrop.is-ready { transition: none; }
}

.app-footer {
  margin-top: auto;
}

:global(html[data-pb-pseudo-fullscreen] aside.app-sidebar),
:global(html[data-pb-pseudo-fullscreen] .app-footer) {
  display: none;
}

:global(html[data-pb-pseudo-fullscreen] .immersive-nav) {
  z-index: calc(var(--z-header) + 2);
}

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
.android-update-notice .app-button { min-height: var(--hit-min-comfortable); }

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
