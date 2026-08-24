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

// Keep showcase/legacy notification copy complete even while older persisted
// notification rows may still use the historical BOOST_REQUEST_SUBMITTED code.
zh.home.boostDesc = '专业陪练服务，提升战斗技巧与实战表现。'
en.home.boostDesc = 'Coaching sessions to improve gameplay and battle performance.'
ru.home.boostDesc = 'Тренировки для улучшения игровых навыков и эффективности в бою.'

zh.boost.notificationTitle.BOOST_REQUEST_SUBMITTED = '陪练需求已提交'
zh.boost.notificationMessage.BOOST_REQUEST_SUBMITTED = '你的陪练需求 #{requestId} 已提交，等待审核。'
en.boost.notificationTitle.BOOST_REQUEST_SUBMITTED = 'Coaching request submitted'
en.boost.notificationMessage.BOOST_REQUEST_SUBMITTED = 'Your coaching request #{requestId} was submitted and is awaiting review.'
ru.boost.notificationTitle.BOOST_REQUEST_SUBMITTED = 'Заявка на тренировку отправлена'
ru.boost.notificationMessage.BOOST_REQUEST_SUBMITTED = 'Ваша заявка #{requestId} отправлена и ожидает проверки.'

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
