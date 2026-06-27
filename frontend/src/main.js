import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import App from './App.vue'
import zh from './locales/zh.json'
import en from './locales/en.json'
import ru from './locales/ru.json'

const i18n = createI18n({
  locale: localStorage.getItem('wotb-lang') || 'zh',
  fallbackLocale: 'en',
  messages: { zh, en, ru },
})

createApp(App).use(i18n).mount('#app')
