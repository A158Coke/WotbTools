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
import './styles/playback-mobile.css'
import './styles/playback-workspace.css'
import './styles/playback-workspace-3d.css'
import { messages } from './locales/messages.js'
import { readLocale } from './i18n/locale-preference.js'
import { sectionTitleKey, viewFromRoute } from './app/navigation.js'
import { useAuth } from './composables/useAuth.js'
import { hasAuthReturn } from './platform/authDiagnostics.js'
import { isAndroidApp } from './composables/usePlatformBridge.js'
import { installPreloadErrorRecovery } from './platform/preloadRecovery.js'

console.info('[build] commit=' + __BUILD_COMMIT__ + ' time=' + __BUILD_TIME__)

installPreloadErrorRecovery()

const previewHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

async function bootstrap() {
  if (!isAndroidApp() && hasAuthReturn()) await useAuth().initPromise

  const previewParams = new URLSearchParams(window.location.search)
  if (previewHost && !previewParams.has('view')) {
    const previewUrl = new URL(window.location.href)
    previewUrl.searchParams.set('view', 'home')
    window.history.replaceState({}, '', previewUrl.toString())
  }

  const { default: router } = await import('./app/router.js')
  const { default: App } = await import('./App.vue')
  const i18n = createI18n({
    locale: readLocale(),
    fallbackLocale: 'en',
    messages,
  })

  createApp(App).use(i18n).use(router).mount('#app')

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

  if (previewHost) {
    requestAnimationFrame(() => {
      const brandLink = document.querySelector('.tb-brand')
      if (brandLink) brandLink.setAttribute('href', '/?view=home')
    })
  }
}

bootstrap()
