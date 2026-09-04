import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import './styles/tokens.css'
import './styles/showcase.css'
import './styles/showcase-workspaces.css'
import './styles/showcase-pages.css'
import './styles/showcase-rankings.css'
import './styles/showcase-backgrounds.css'
import './styles/showcase-backgrounds-v3.css'
import './styles/showcase-cohesion.css'
import './styles/showcase-regressions.css'
import './styles/app-shell.css'
import './styles/playback-overlap-ux.css'
import './styles/playback-shared.css'
// 形态文件排在基础表之后：迁出的规则原本就在后面，顺序不变则同特异性的胜负不变。
// 三档互斥（根元素只挂一个 pb-form-*），三者之间没有层叠冲突，顺序无关紧要。
import './styles/playback-pc.css'
import './styles/playback-tablet.css'
import './styles/playback-mobile.css'
// Mobile fullscreen has stricter map-first behavior than the generic mobile form:
// controller is transient and vehicle details must resize, never cover, the map.
import './styles/playback-mobile-fullscreen.css'
import './styles/classic-profile.css'
import { messages } from './locales/messages.js'
import router from './app/router.js'

// Build identity（vite define 注入）：生产环境可立即确认实际运行的 bundle 版本，
// 避免"我刚部署了"式猜测（对应 /version.json 与 /?view=version 可查）。
console.info('[build] commit=' + __BUILD_COMMIT__ + ' time=' + __BUILD_TIME__)

const previewHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

async function bootstrap() {
  // Local preview intentionally starts on Home while production defaults to Replay.
  const previewParams = new URLSearchParams(window.location.search)
  if (previewHost && !previewParams.has('view')) {
    const previewUrl = new URL(window.location.href)
    previewUrl.searchParams.set('view', 'home')
    window.history.replaceState({}, '', previewUrl.toString())
  }

  const { default: App } = await import('./App.vue')
  const i18n = createI18n({
    locale: localStorage.getItem('wotb-lang') || 'zh',
    fallbackLocale: 'en',
    messages,
  })

  createApp(App).use(i18n).use(router).mount('#app')

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
