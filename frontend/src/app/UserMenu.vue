<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { useUiProfile } from '../composables/useUiProfile.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { NAVIGATE_VIEW_KEY } from './context.js'

const navigate = inject(NAVIGATE_VIEW_KEY)
const { login, logout, isAuthenticated, userName, tokenParsed } = useAuth()
const { uiProfile, setUiProfile } = useUiProfile()
const open = ref(false)
const position = ref({ top: 0, right: 16 })
const trigger = ref(null)
const panel = ref(null)
const isAdmin = computed(() => (tokenParsed.value?.realm_access?.roles || []).includes('wotbtools-admin'))
const isHofAdmin = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles || []
  return roles.includes('HoF-admin') || roles.includes('wotbtools-admin')
})

function close() { open.value = false }
function toggle() {
  if (open.value) return close()
  const rect = trigger.value?.getBoundingClientRect()
  if (rect) position.value = { top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) }
  open.value = true
}
function onDocumentClick(event) {
  if (open.value && !trigger.value?.contains(event.target) && !panel.value?.contains(event.target)) close()
}
function onDocumentKeydown(event) {
  if (event.key === 'Escape') close()
}
function go(view) { close(); navigate(view) }
function handleLogin() { close(); login('profile') }
function handleLogout() { close(); logout() }

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div class="dropdown user-menu">
    <button ref="trigger" class="auth-btn ghost user-menu-trigger" @click="toggle" :aria-expanded="open" :aria-haspopup="true">
      {{ isAuthenticated() ? userName() : $t('app.login') }} <span class="caret">▼</span>
    </button>
    <Teleport to="body">
      <div v-if="open" ref="panel" class="user-menu-panel" :style="{ top: position.top + 'px', right: position.right + 'px' }" role="menu">
        <div class="user-menu-section" :aria-label="$t('uiProfile.title')">
          <div class="user-menu-section-title">{{ $t('uiProfile.title') }}</div>
          <div class="ui-profile-segmented" role="group" :aria-label="$t('uiProfile.title')">
            <button class="ui-profile-option" :class="{ active: uiProfile === 'classic' }" :aria-pressed="uiProfile === 'classic'" @click="setUiProfile('classic')">{{ $t('uiProfile.classic') }}</button>
            <button class="ui-profile-option" :class="{ active: uiProfile === 'showcase' }" :aria-pressed="uiProfile === 'showcase'" @click="setUiProfile('showcase')">{{ $t('uiProfile.showcase') }}</button>
          </div>
        </div>
        <div class="user-menu-divider"></div>
        <template v-if="isAuthenticated()">
          <button class="user-menu-item" role="menuitem" @click="go('profile')">{{ $t('app.profile') }}</button>
          <button v-if="isAdmin" class="user-menu-item" role="menuitem" @click="go('admin-users')">{{ $t('admin.title') }}</button>
          <button v-if="isHofAdmin" class="user-menu-item" role="menuitem" @click="go('hof-admin')">{{ $t('hofAdmin.cardTitle') }}</button>
          <button class="user-menu-item" role="menuitem" @click="go('version')">{{ $t('version.btn') }}</button>
          <button v-if="!isAndroidApp()" class="user-menu-item" role="menuitem" @click="go('android')">{{ $t('android.nav') }}</button>
          <button class="user-menu-item" role="menuitem" @click="go('contact')">{{ $t('contact.nav') }}</button>
          <a class="user-menu-item" role="menuitem" href="https://github.com/A158Coke/WotbTools/issues/new" target="_blank" rel="noopener">{{ $t('app.feedback') }}</a>
          <button class="user-menu-item danger" role="menuitem" @click="handleLogout">{{ $t('profile.logout') }}</button>
        </template>
        <template v-else>
          <button class="user-menu-item" role="menuitem" @click="handleLogin">{{ $t('app.login') }}</button>
          <button class="user-menu-item" role="menuitem" @click="go('version')">{{ $t('version.btn') }}</button>
          <button class="user-menu-item" role="menuitem" @click="go('contact')">{{ $t('contact.nav') }}</button>
          <a class="user-menu-item" role="menuitem" href="https://github.com/A158Coke/WotbTools/issues/new" target="_blank" rel="noopener">{{ $t('app.feedback') }}</a>
        </template>
      </div>
    </Teleport>
  </div>
</template>
