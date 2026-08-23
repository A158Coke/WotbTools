import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import App from './App.vue'
import './styles/tokens.css'
import './styles/showcase.css'
import './styles/showcase-workspaces.css'
import './styles/showcase-pages.css'
import './styles/showcase-rankings.css'
import './styles/showcase-backgrounds.css'
import zh from './locales/zh.json'
import en from './locales/en.json'
import ru from './locales/ru.json'

// UI review convenience: Vite localhost should open the real HomePage by default,
// not the production-oriented replay fallback. Explicit ?view=... always wins.
const previewHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
const previewParams = new URLSearchParams(window.location.search)
if (previewHost && !previewParams.has('view')) {
  const previewUrl = new URL(window.location.href)
  previewUrl.searchParams.set('view', 'home')
  window.history.replaceState({}, '', previewUrl.toString())
}

const i18n = createI18n({
  locale: localStorage.getItem('wotb-lang') || 'zh',
  fallbackLocale: 'en',
  messages: { zh, en, ru },
})

const app = createApp(App).use(i18n)
app.mount('#app')

// The legacy brand link intentionally targets production. During local UI review,
// keep it inside the local SPA so the logo can always return to the showcase home.
if (previewHost) {
  requestAnimationFrame(() => {
    const brandLink = document.querySelector('.tb-brand')
    if (brandLink) brandLink.setAttribute('href', '/?view=home')
  })
}
