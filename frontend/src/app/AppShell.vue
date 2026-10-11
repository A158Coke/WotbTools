<script setup>
import { computed, onMounted, provide, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth.js'
import { shouldEnsureBusinessUser, useBusinessUserBootstrap } from '../composables/useBusinessUserBootstrap.js'
import { useConnectivity } from '../composables/useConnectivity.js'
import { useConnectivityNotice } from '../composables/useConnectivityNotice.js'
import { useError } from '../composables/useError.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { useOnboarding } from '../composables/useOnboarding.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { Feature } from './featureCapabilities.js'
import { locationForView, viewFromRoute } from './navigation.js'
import AppTopBar from './AppTopBar.vue'
import AppTabBar from './AppTabBar.vue'
import AppSidebar from './AppSidebar.vue'
import GlobalErrorDialog from './GlobalErrorDialog.vue'
import ConnectivityNoticeDialog from './ConnectivityNoticeDialog.vue'
import ConfirmDialogHost from '../components/ConfirmDialogHost.vue'
import OnboardingHost from '../components/OnboardingHost.vue'
import publicSecurityFilingIcon from '../assets/public-security-filing.png'

const router = useRouter()
const route = useRoute()
const { error: globalError, showError: showGlobalError, close: closeGlobalError } = useError()
const { notice: connectivityNotice, close: closeConnectivityNotice } = useConnectivityNotice()
// 外壳按可用宽度切换（design-language §9）：compact 用标题栏 + 底部 Tab 栏；平板 / 桌面用左侧边栏
const { isCompact } = useBreakpoint()

/**
 * 连通性监听在这里启动一次（进程内单例）：Android 壳走系统 ConnectivityManager（bridge v2），
 * 浏览器走 navigator.onLine。业务页面不得自行监听 —— 它们只读 capability 门禁的结果。
 */
const { connectivity, start: startConnectivity } = useConnectivity()
// 门禁（唯一判定入口）：重试等交互用它 —— 既弹统一 connectivity notice，又给出布尔结果。
const { requireFeature } = useFeatureGate()
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
const { authInitState, authenticated } = useAuth()
const { failed, ensure, retry } = useBusinessUserBootstrap()

watch([authInitState, authenticated, connectivity], ([state, isLoggedIn, currentConnectivity]) => {
  if (!shouldEnsureBusinessUser({
    authInitState: state,
    authenticated: isLoggedIn,
    connectivity: currentConnectivity,
  })) return
  // Auth generation changes are authoritative; ensure itself deduplicates ready/in-flight work.
  void ensure({
    authInitState: state,
    authenticated: isLoggedIn,
    connectivity: currentConnectivity,
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
  }
  if (!shouldEnsureBusinessUser(context)) {
    requireFeature(Feature.ACCOUNT_PROFILE)
    return
  }
  void retry(context)
}

/**
 * 登出 / 会话失效 → **HOME**（2.1.0 Phase 5.3/5.4）：authenticated true→false 时把本 SPA
 * 收敛到首页。浏览器端这一步发生在跳 Keycloak end-session 之前（local-first 已先清本地态）；
 * Android 端 WebView 不导航，这一跳就是它唯一的落点。
 * init 重建期间（authInitState=initializing）的中间态不是登出：不导航。
 */
let previousAuthenticated = authenticated.value
watch(authenticated, (now) => {
  const was = previousAuthenticated
  previousAuthenticated = now
  if (!was || now) return
  if (authInitState.value === 'initializing') return
  navigate('home')
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
const onboarding = useOnboarding({
  navigate,
  view: computed(() => viewFromRoute(route)),
  canInvite: computed(() => !showGlobalError.value && !connectivityNotice.value && !failed.value),
})
provide(ONBOARDING_KEY, onboarding.context)
</script>

<template>
  <AppTopBar v-if="isCompact" compact />
  <AppSidebar v-else />
  <div v-if="failed" class="business-bootstrap-notice" role="alert" data-testid="business-bootstrap-notice">
    <span>{{ $t('bootstrap.profileFailed') }}</span>
    <button type="button" class="business-bootstrap-retry" @click="retryBusinessBootstrap">{{ $t('bootstrap.retry') }}</button>
  </div>
  <RouterView />
  <footer class="app-footer" data-testid="app-footer">
    <div class="app-footer-filings">
      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="icp-filing-link"
      >{{ $t('home.icpFiling') }}</a>
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
  <AppTabBar v-if="isCompact" />
  <GlobalErrorDialog :error="globalError" :visible="showGlobalError" @close="closeGlobalError" />
  <ConnectivityNoticeDialog
    :title-key="connectivityNotice?.titleKey"
    :message-key="connectivityNotice?.messageKey"
    :hint-key="connectivityNotice?.hintKey"
    :visible="!!connectivityNotice"
    @close="closeConnectivityNotice"
  />
  <ConfirmDialogHost />
  <OnboardingHost :onboarding="onboarding" />
</template>

<style scoped>
/* Keep the shared footer at the viewport bottom on short pages without pinning it over content. */
:global(#app) {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

/* 侧边栏是 fixed：内容整体让出 --sidebar-w（手机为 0）。底部 Tab 栏同理在页面底部留出空间 */
:global(#app) { padding-inline-start: var(--sidebar-w); }

@media (width < 768px) {
  :global(#app) { padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom)); }
}

.app-footer {
  margin-top: auto;
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
