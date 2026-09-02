<script setup>
import { computed, inject } from 'vue'
import { useRoute } from 'vue-router'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { isHomeHost, viewFromRoute } from './navigation.js'
import { useAuth } from '../composables/useAuth.js'
import UserMenu from './UserMenu.vue'

const route = useRoute()
const navigate = inject('navigate')
const activeView = computed(() => viewFromRoute(route))
const { hasRole } = useAuth()
const showBoost = computed(() => hasRole('wotbtools-admin'))
const showHome = isHomeHost(window.location.hostname)
const languageOptions = [
  { key: 'zh', label: '中文' },
  { key: 'en', label: 'English' },
  { key: 'ru', label: 'Русский' },
]

function onLangChange(event) {
  localStorage.setItem('wotb-lang', event.target.value)
}
</script>

<template>
  <div class="topbar">
    <a class="tb-brand" href="https://wotbtools.com">
      <img class="tb-logo" src="/wotbtoolslogo.png" alt="WoTBTools">
    </a>
    <nav>
      <button v-if="showHome" :class="{ active: activeView === 'home' }" @click="navigate('home')">{{ $t('profile.home') }}</button>
      <button :class="{ active: ['replay', 'ai-review', 'battle-playback'].includes(activeView) }" @click="navigate('replay')">{{ $t('home.replayParse') }}</button>
      <button :class="{ active: activeView === 'hof' }" @click="navigate('hof')">{{ $t('hof.btn') }}</button>
      <button v-if="showBoost" :class="{ active: activeView === 'boost' }" @click="navigate('boost')">{{ $t('app.boost_tab') }}</button>
    </nav>
    <div class="tb-spacer"></div>
    <select class="lang-select" v-model="$i18n.locale" @change="onLangChange">
      <option v-for="language in languageOptions" :key="language.key" :value="language.key">{{ language.label }}</option>
    </select>
    <button v-if="!isAndroidApp() && activeView === 'home'" class="auth-btn ghost android-download-btn" @click="navigate('android')" :title="$t('android.nav')">{{ $t('android.nav') }}</button>
    <UserMenu />
  </div>
</template>
