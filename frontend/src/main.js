import { createApp, watch } from 'vue'
import { createI18n } from 'vue-i18n'
import './styles/tokens/scale.css'
import './styles/tokens/color.css'
import './styles/tokens.css'
import './styles/showcase.css'
import './styles/showcase-workspaces.css'
import './styles/showcase-pages.css'
import './styles/showcase-rankings.css'
import './styles/showcase-cohesion.css'
import './styles/showcase-regressions.css'
import './styles/app-shell.css'
import './styles/playback-overlap-ux.css'
import './styles/playback-shared.css'
// Form styles only own peripheral navigation/portrait behavior.
import './styles/playback-mobile.css'
// 正方形 Stage 的三段式 workspace（Team 1 | Stage | Team 2、手机竖屏纵向流、详情浮窗层）。
// Shared sizing authority for every form and fullscreen mode.
import './styles/playback-workspace.css'
import './styles/classic-profile.css'
import { messages } from './locales/messages.js'
import { sectionTitleKey, viewFromRoute } from './app/navigation.js'
import { useAuth } from './composables/useAuth.js'
import { isAndroidApp } from './composables/usePlatformBridge.js'

// Build identity（vite define 注入）：生产环境可立即确认实际运行的 bundle 版本，
// 避免"我刚部署了"式猜测（对应同源 /version.json 可查）。
console.info('[build] commit=' + __BUILD_COMMIT__ + ' time=' + __BUILD_TIME__)

const previewHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

async function bootstrap() {
  // A Web login return belongs to keycloak-js before any history/route rewrite.
  // Only inspect parameter presence here; the adapter alone validates state/PKCE and
  // consumes the callback. Ordinary visits keep rendering during check-sso, and APK
  // auth remains Native-owned without blocking its local tools on the bridge.
  const hasAuthReturn = [window.location.search, window.location.hash.slice(1)].some(value => {
    const params = new URLSearchParams(value)
    return params.has('state') && (params.has('code') || params.has('error'))
  })
  if (!isAndroidApp() && hasAuthReturn) await useAuth().initPromise

  // Local preview intentionally starts on Home while production defaults to Replay.
  const previewParams = new URLSearchParams(window.location.search)
  if (previewHost && !previewParams.has('view')) {
    const previewUrl = new URL(window.location.href)
    previewUrl.searchParams.set('view', 'home')
    window.history.replaceState({}, '', previewUrl.toString())
  }

  // createWebHistory snapshots the current URL; even importing the router before
  // callback consumption would retain stale OIDC parameters in route state.
  const { default: router } = await import('./app/router.js')
  const { default: App } = await import('./App.vue')
  const i18n = createI18n({
    locale: localStorage.getItem('wotb-lang') || 'zh',
    fallbackLocale: 'en',
    messages,
  })

  createApp(App).use(i18n).use(router).mount('#app')

  // 审计 PG-16：<html lang> 与标签页标题跟随界面语言和当前区块（原来固定为中文）
  const HTML_LANG = { zh: 'zh-CN', en: 'en', ru: 'ru' }
  const syncDocumentMeta = () => {
    const lang = i18n.global.locale
    document.documentElement.lang = HTML_LANG[lang] || lang
    const key = sectionTitleKey(viewFromRoute(router.currentRoute.value))
    document.title = key ? `${i18n.global.t(key)} · WoTBTools` : 'WoTBTools'
  }
  router.afterEach(() => syncDocumentMeta())
  watch(() => i18n.global.locale, syncDocumentMeta)
  syncDocumentMeta()

  // Production intentionally links the brand to wotbtools.com. During localhost UI review,
  // keep the brand in the local SPA and make it a reliable Home button.
  if (previewHost) {
    requestAnimationFrame(() => {
      const brandLink = document.querySelector('.tb-brand')
      if (brandLink) brandLink.setAttribute('href', '/?view=home')
    })
  }
}

bootstrap()
