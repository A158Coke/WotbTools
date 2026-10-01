<script setup>
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth.js'
import { defaultView, locationForView, primaryNavItems, primarySection, viewFromRoute } from './navigation.js'
import { ACCOUNT_ICON, PRIMARY_NAV_ICONS } from './navIcons.js'

// 桌面 / 平板：logo · 主导航 · 更多 · 账户。手机（compact）：logo · 当前栏目名 · 账户，主导航交给底部 Tab 栏。
const props = defineProps({ compact: { type: Boolean, default: false } })

const route = useRoute()
const { isAdmin, isAuthenticated, displayName } = useAuth()
const activeView = computed(() => viewFromRoute(route, { allowAdminViews: isAdmin.value }))
const activeSection = computed(() => primarySection(activeView.value))
const items = primaryNavItems()
const sectionItems = items.filter(item => item.id !== 'more')
const moreItem = items.find(item => item.id === 'more')
const activeItem = computed(() => items.find(item => item.id === activeSection.value))
const sectionTitleKey = computed(() => activeItem.value?.labelKey ?? (activeSection.value === 'account' ? 'nav.account' : null))
const brandTarget = computed(() => locationForView(defaultView(), route))
const accountLabel = computed(() => (isAuthenticated() && displayName.value) || null)
const showDevEnvironmentNotice = import.meta.env.DEV
const devEnvironmentNoticeKey = import.meta.env.MODE === 'production-remote'
  ? 'environment.productionRemote'
  : 'environment.local'

function to(view) {
  return locationForView(view, route)
}
</script>

<template>
  <header class="app-top-bar" :class="{ 'is-compact': props.compact }" data-testid="app-top-bar">
    <RouterLink class="brand" :to="brandTarget" :aria-label="'WoTBTools'">
      <img class="brand-logo" src="/wotbtoolslogo.png" alt="" aria-hidden="true">
    </RouterLink>

    <span v-if="props.compact && sectionTitleKey" class="section-title">{{ $t(sectionTitleKey) }}</span>

    <nav v-else-if="!props.compact" class="primary-nav" :aria-label="$t('nav.primary')">
      <RouterLink
        v-for="item in sectionItems"
        :key="item.id"
        class="primary-nav-link"
        :class="{ 'is-active': activeSection === item.id }"
        :to="to(item.view)"
        :aria-current="activeSection === item.id ? 'page' : undefined"
        :data-testid="`nav-${item.id}`"
      >{{ $t(item.labelKey) }}</RouterLink>
    </nav>

    <span
      v-if="showDevEnvironmentNotice"
      class="dev-notice"
      data-testid="dev-environment-notice"
      role="status"
      :title="$t(devEnvironmentNoticeKey)"
    >
      {{ $t('environment.label') }}<template v-if="!props.compact"> · {{ $t(devEnvironmentNoticeKey) }}</template>
    </span>

    <div class="end-actions">
      <RouterLink
        v-if="!props.compact"
        class="primary-nav-link"
        :class="{ 'is-active': activeSection === 'more' }"
        :to="to(moreItem.view)"
        :aria-current="activeSection === 'more' ? 'page' : undefined"
        data-testid="nav-more"
      >
        <component :is="PRIMARY_NAV_ICONS.more" :size="20" aria-hidden="true" />
        <span>{{ $t(moreItem.labelKey) }}</span>
      </RouterLink>
      <RouterLink
        class="account-link"
        :class="{ 'is-active': activeSection === 'account' }"
        :to="to('profile')"
        :aria-current="activeSection === 'account' ? 'page' : undefined"
        :aria-label="props.compact ? $t('nav.account') : undefined"
        data-testid="nav-account"
      >
        <component :is="ACCOUNT_ICON" :size="20" aria-hidden="true" />
        <span v-if="!props.compact" class="account-label">{{ accountLabel ?? $t('app.login') }}</span>
      </RouterLink>
    </div>
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
.brand-logo { display: block; width: auto; height: 32px; }
.is-compact .brand-logo { height: 28px; }

.section-title {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font: var(--type-h3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.primary-nav { display: flex; align-self: stretch; gap: var(--space-1); min-width: 0; }

.primary-nav-link,
.account-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border-bottom: 2px solid transparent;
  color: var(--color-text-secondary);
  font: var(--type-body);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.primary-nav-link.is-active,
.account-link.is-active {
  border-bottom-color: var(--color-accent);
  color: var(--color-text-primary);
}

.primary-nav-link:focus-visible,
.account-link:focus-visible,
.brand:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.end-actions { display: flex; align-self: stretch; gap: var(--space-1); margin-inline-start: auto; }
.is-compact .end-actions { align-self: center; }
.is-compact .account-link { min-width: var(--hit-min); min-height: var(--hit-min); justify-content: center; padding: 0; border-bottom: 0; }
.account-label { max-width: 16ch; overflow: hidden; text-overflow: ellipsis; }

.dev-notice {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-sm);
  color: var(--color-warning);
  font: var(--type-caption);
  white-space: nowrap;
}

.is-compact .dev-notice { margin-inline-start: auto; }
.is-compact .dev-notice + .end-actions { margin-inline-start: 0; }

@media (hover: hover) {
  .primary-nav-link:not(.is-active):hover,
  .account-link:not(.is-active):hover { color: var(--color-text-primary); }
}
</style>
