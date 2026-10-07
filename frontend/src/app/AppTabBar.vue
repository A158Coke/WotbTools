<script setup>
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { locationForView, primaryNavItems, primarySection, viewFromRoute } from './navigation.js'
import { PRIMARY_NAV_ICONS } from './navIcons.js'

// 手机 / App 的主导航（design-language §9）：固定在底部，高度 --tabbar-h + 底部安全区。
const route = useRoute()
const activeSection = computed(() => primarySection(viewFromRoute(route)))
const items = primaryNavItems()
</script>

<template>
  <nav class="app-tab-bar" :aria-label="$t('nav.primary')" data-testid="app-tab-bar">
    <RouterLink
      v-for="item in items"
      :key="item.id"
      class="tab"
      :class="{ 'is-active': activeSection === item.id }"
      :to="locationForView(item.view, route)"
      :aria-current="activeSection === item.id ? 'page' : undefined"
      :data-testid="`tab-${item.id}`"
    >
      <component :is="PRIMARY_NAV_ICONS[item.id]" :size="24" aria-hidden="true" />
      <span class="tab-label">{{ $t(item.labelKey) }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.app-tab-bar {
  position: fixed;
  inset-inline: 0;
  bottom: 0;
  z-index: var(--z-header);
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  height: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  border-top: 1px solid var(--color-border-subtle);
  background: color-mix(in oklab, var(--color-canvas) 94%, transparent);
  backdrop-filter: blur(12px);
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: var(--hit-min);
  color: var(--color-text-tertiary);
  text-decoration: none;
}

.tab.is-active { color: var(--color-accent-text); }
.tab-label {
  max-width: 100%;
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font: var(--type-caption);
  font-weight: 600;
  /* Reserve the icon, gap and borders before fitting two caption lines. */
  line-height: min(var(--line-height-caption), calc((var(--tabbar-h) - 28px) / 2));
  text-align: center;
}
.tab:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }
</style>
