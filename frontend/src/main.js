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
import zh from './locales/zh.json'
import en from './locales/en.json'
import ru from './locales/ru.json'

const previewHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

async function bootstrap() {
  // App.vue reads location during module evaluation. Therefore local UI preview routing
  // must be canonicalized BEFORE App.vue is imported, otherwise localhost defaults to replay.
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
    messages: { zh, en, ru },
  })

  createApp(App).use(i18n).mount('#app')

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
