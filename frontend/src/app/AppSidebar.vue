<script setup>
// 平板 / 桌面的应用导航（design-language §9）：固定在左侧、铺满视口高度。
// 上：品牌 · 主栏目 · 管理组（按角色）；下：更多（弹出面板，放低频设置）· 账户 · 折叠开关（仅桌面）。
// 平板（768–1199）固定为图标栏；桌面（≥1200）默认展开，可折叠成图标栏（useSidebar 记忆偏好）。
// 图标栏里文字标签视觉隐藏但保留为可访问名称，悬停另有 title 提示。
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'
import { useAuth } from '../composables/useAuth.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { useSidebar } from '../composables/useSidebar.js'
import { ADMIN_NAV, defaultView, locationForView, primaryNavItems, primarySection, viewFromRoute } from './navigation.js'
import { ACCOUNT_ICON, ADMIN_NAV_ICONS, PRIMARY_NAV_ICONS } from './navIcons.js'
import MorePanel from './MorePanel.vue'

const route = useRoute()
const { isAdmin, isHofAdmin, isAuthenticated, displayName } = useAuth()
const { isExpanded } = useBreakpoint()
const { collapsed, toggle } = useSidebar()

/** 图标栏：平板一律；桌面在用户折叠时 */
const rail = computed(() => !isExpanded.value || collapsed.value)
const activeSection = computed(() => primarySection(viewFromRoute(route, { allowAdminViews: isAdmin.value })))
const items = primaryNavItems()
const sectionItems = items.filter(item => item.id !== 'more')
const moreItem = items.find(item => item.id === 'more')
const adminItems = computed(() => ADMIN_NAV.filter(item => (item.role === 'hofAdmin' ? isHofAdmin.value : isAdmin.value)))
const brandTarget = computed(() => locationForView(defaultView(), route))
const accountLabel = computed(() => (isAuthenticated() && displayName.value) || null)
const showDevEnvironmentNotice = import.meta.env.DEV
const devEnvironmentNoticeKey = import.meta.env.MODE === 'production-remote'
  ? 'environment.productionRemote'
  : 'environment.local'

const moreOpen = ref(false)
const moreTrigger = ref(null)
const morePanelId = 'app-more-panel'

function to(view) {
  return locationForView(view, route)
}

function linkAttrs(id) {
  const active = activeSection.value === id
  return { class: { 'is-active': active }, 'aria-current': active ? 'page' : undefined }
}
</script>

<template>
  <aside class="app-sidebar" :class="{ 'is-rail': rail }" data-testid="app-sidebar">
    <RouterLink class="sidebar-brand" :to="brandTarget" aria-label="WoTBTools">
      <img class="sidebar-logo" src="/wotbtoolslogo-128.webp" width="128" height="128" alt="" aria-hidden="true">
      <span v-if="!rail" class="sidebar-brand-name">WoTBTools</span>
    </RouterLink>

    <span
      v-if="showDevEnvironmentNotice"
      class="sidebar-dev-notice"
      data-testid="dev-environment-notice"
      role="status"
      :title="$t(devEnvironmentNoticeKey)"
    >{{ $t('environment.label') }}<template v-if="!rail"> · {{ $t(devEnvironmentNoticeKey) }}</template></span>

    <nav class="sidebar-nav" :aria-label="$t('nav.primary')">
      <ul class="sidebar-list">
        <li v-for="item in sectionItems" :key="item.id">
          <RouterLink
            class="sidebar-link"
            v-bind="linkAttrs(item.id)"
            :to="to(item.view)"
            :title="rail ? $t(item.labelKey) : undefined"
            :data-testid="`nav-${item.id}`"
          >
            <component :is="PRIMARY_NAV_ICONS[item.id]" :size="20" aria-hidden="true" />
            <span class="sidebar-label">{{ $t(item.labelKey) }}</span>
          </RouterLink>
        </li>
      </ul>

      <template v-if="adminItems.length">
        <h2 class="sidebar-group-title" :class="{ 'visually-hidden': rail }">{{ $t('more.sections.admin') }}</h2>
        <hr v-if="rail" class="sidebar-divider" aria-hidden="true">
        <ul class="sidebar-list">
          <li v-for="item in adminItems" :key="item.id">
            <RouterLink
              class="sidebar-link"
              v-bind="linkAttrs(item.id)"
              :to="to(item.view)"
              :title="rail ? $t(item.labelKey) : undefined"
              :data-testid="`nav-${item.id}`"
            >
              <component :is="ADMIN_NAV_ICONS[item.id]" :size="20" aria-hidden="true" />
              <span class="sidebar-label">{{ $t(item.labelKey) }}</span>
            </RouterLink>
          </li>
        </ul>
      </template>
    </nav>

    <div class="sidebar-footer">
      <button
        ref="moreTrigger"
        type="button"
        class="sidebar-link"
        :class="{ 'is-active': activeSection === 'more', 'is-open': moreOpen }"
        :aria-current="activeSection === 'more' ? 'page' : undefined"
        :aria-expanded="moreOpen ? 'true' : 'false'"
        :aria-controls="morePanelId"
        :title="rail ? $t(moreItem.labelKey) : undefined"
        data-testid="nav-more"
        @click="moreOpen = !moreOpen"
      >
        <component :is="PRIMARY_NAV_ICONS.more" :size="20" aria-hidden="true" />
        <span class="sidebar-label">{{ $t(moreItem.labelKey) }}</span>
      </button>

      <RouterLink
        class="sidebar-link"
        v-bind="linkAttrs('account')"
        :to="to('profile')"
        :title="rail ? (accountLabel ?? $t('app.login')) : undefined"
        data-testid="nav-account"
      >
        <component :is="ACCOUNT_ICON" :size="20" aria-hidden="true" />
        <span class="sidebar-label sidebar-account-label">{{ accountLabel ?? $t('app.login') }}</span>
      </RouterLink>

      <button
        v-if="isExpanded"
        type="button"
        class="sidebar-link sidebar-collapse"
        :aria-label="collapsed ? $t('nav.expandSidebar') : $t('nav.collapseSidebar')"
        :title="collapsed ? $t('nav.expandSidebar') : $t('nav.collapseSidebar')"
        data-testid="sidebar-collapse"
        @click="toggle"
      >
        <component :is="collapsed ? PanelLeftOpen : PanelLeftClose" :size="20" aria-hidden="true" />
        <span v-if="!rail" class="sidebar-label" aria-hidden="true">{{ $t('nav.collapseSidebar') }}</span>
      </button>
    </div>

    <MorePanel :id="morePanelId" :open="moreOpen" :anchor="moreTrigger" @close="moreOpen = false" />
  </aside>
</template>

<style scoped>
.app-sidebar {
  position: fixed;
  inset-block: 0;
  inset-inline-start: 0;
  z-index: var(--z-header);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: var(--sidebar-w);
  padding: calc(var(--space-3) + env(safe-area-inset-top)) var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom));
  padding-inline-start: calc(var(--space-3) + env(safe-area-inset-left));
  overflow-x: hidden;
  overflow-y: auto;
  border-inline-end: 1px solid var(--color-border-subtle);
  background: var(--color-canvas);
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h-lg);
  padding-inline: var(--space-2);
  color: var(--color-text-primary);
  text-decoration: none;
}

.is-rail .sidebar-brand { justify-content: center; padding-inline: 0; }
.sidebar-logo { display: block; flex: none; width: auto; height: 32px; }
.sidebar-brand-name { font: var(--type-h3); white-space: nowrap; }

.sidebar-dev-notice {
  padding: var(--space-1) var(--space-2);
  overflow: hidden;
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-sm);
  color: var(--color-warning);
  font: var(--type-caption);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-nav { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-2); }
.sidebar-list { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }

.sidebar-group-title {
  margin: var(--space-4) 0 var(--space-1);
  padding-inline: var(--space-3);
  color: var(--color-text-tertiary);
  font: var(--type-caption);
  font-weight: 600;
}

.sidebar-divider {
  width: 100%;
  margin: var(--space-2) 0;
  border: 0;
  border-top: 1px solid var(--color-border-subtle);
}

.sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: auto;
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border-subtle);
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--control-h-lg);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font: var(--type-body);
  font-weight: 600;
  text-align: start;
  text-decoration: none;
  cursor: pointer;
}

.sidebar-link > svg { flex: none; }
.sidebar-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sidebar-link.is-active {
  background: color-mix(in oklab, var(--color-accent) 16%, var(--color-canvas));
  color: var(--color-accent-text);
}

.sidebar-link.is-open { background: var(--color-surface-2); color: var(--color-text-primary); }

.sidebar-link:focus-visible,
.sidebar-brand:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }

/* 图标栏：只剩图标，文字留给读屏（title 提供悬停提示） */
.is-rail .sidebar-link { justify-content: center; padding: 0; }

.is-rail .sidebar-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.sidebar-collapse { color: var(--color-text-tertiary); }

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (hover: hover) {
  .sidebar-link:not(.is-active):hover { background: var(--color-surface-2); color: var(--color-text-primary); }
}
</style>
