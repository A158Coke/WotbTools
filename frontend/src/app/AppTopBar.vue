<script setup>
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth.js'
import { defaultView, locationForView, primarySection, sectionTitleKey as titleKeyFor, viewFromRoute } from './navigation.js'
import { ACCOUNT_ICON } from './navIcons.js'

// 手机 / App（compact）的标题栏：logo · 当前栏目名 · 账户。主导航在底部 Tab 栏；
// 平板 / 桌面没有顶栏，导航在左侧边栏（AppSidebar）。
const route = useRoute()
const { isAdmin } = useAuth()
const activeView = computed(() => viewFromRoute(route, { allowAdminViews: isAdmin.value }))
const activeSection = computed(() => primarySection(activeView.value))
const sectionTitleKey = computed(() => titleKeyFor(activeView.value))
const brandTarget = computed(() => locationForView(defaultView(), route))
const showDevEnvironmentNotice = import.meta.env.DEV
const devEnvironmentNoticeKey = import.meta.env.MODE === 'production-remote'
  ? 'environment.productionRemote'
  : 'environment.local'
</script>

<template>
  <header class="app-top-bar" data-testid="app-top-bar">
    <RouterLink class="brand" :to="brandTarget" aria-label="WoTBTools">
      <img class="brand-logo" src="/wotbtoolslogo-128.webp" width="128" height="128" alt="" aria-hidden="true">
    </RouterLink>

    <span v-if="sectionTitleKey" class="section-title">{{ $t(sectionTitleKey) }}</span>

    <span
      v-if="showDevEnvironmentNotice"
      class="dev-notice"
      data-testid="dev-environment-notice"
      role="status"
      :title="$t(devEnvironmentNoticeKey)"
    >{{ $t('environment.label') }}</span>

    <RouterLink
      class="account-link"
      :class="{ 'is-active': activeSection === 'account' }"
      :to="locationForView('profile', route)"
      :aria-current="activeSection === 'account' ? 'page' : undefined"
      :aria-label="$t('nav.account')"
      data-testid="nav-account"
    >
      <component :is="ACCOUNT_ICON" :size="20" aria-hidden="true" />
    </RouterLink>
  </header>
</template>

<style scoped>
.app-top-bar {
  position: fixed;
  inset-inline: 0;
  top: 0;
  z-index: var(--z-header);
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: calc(var(--header-h) + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) var(--gutter) 0;
  border-bottom: 1px solid var(--color-border-subtle);
  background: color-mix(in oklab, var(--color-canvas) 92%, transparent);
  backdrop-filter: blur(12px);
}

.brand { display: inline-flex; align-items: center; flex: none; }
.brand-logo { display: block; width: auto; height: 28px; }

.section-title {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font: var(--type-h3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  margin-inline-start: auto;
  color: var(--color-text-secondary);
}

.account-link.is-active { color: var(--color-accent-text); }

.account-link:focus-visible,
.brand:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.dev-notice {
  margin-inline-start: auto;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-sm);
  color: var(--color-warning);
  font: var(--type-caption);
  white-space: nowrap;
}

.dev-notice + .account-link { margin-inline-start: 0; }
</style>
