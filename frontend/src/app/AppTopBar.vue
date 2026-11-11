<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Bell, Heart, Menu } from 'lucide-vue-next'
import { unreadCount } from '../composables/useNotifications.js'
import { NOTIFICATIONS_PANEL_KEY } from '../shared/notifications.js'
import { defaultView, isWorkspaceView, locationForView, primarySection, sectionTitleKey as titleKeyFor, viewFromRoute } from './navigation.js'
import { ACCOUNT_ICON } from './navIcons.js'
import BrandMark from '../components/BrandMark.vue'

// 抽屉外壳（手机竖屏 / 手机横屏）的顶栏：菜单（打开左侧抽屉）· logo · 当前栏目名 · 账户（§9 L1 / L3）。
// 普通页面向下滚动收起、向上滚动出现（L5）；工作台（回放、装甲查看器、地图、科技树）不收起。
// 平板 / 桌面没有顶栏，导航在左侧边栏（AppSidebar）。
// 首页首屏：顶栏浮在主视觉上（玻璃底、无分隔线），并多一个「♥ 赞助」按钮；滚过首屏后恢复实底。
const props = defineProps({ navOpen: { type: Boolean, default: false } })
const emit = defineEmits(['open-nav'])
const menuButton = ref(null)
const openNotifications = inject(NOTIFICATIONS_PANEL_KEY, null)
defineExpose({ menuButton })
const route = useRoute()
const activeView = computed(() => viewFromRoute(route))
const activeSection = computed(() => primarySection(activeView.value))
const sectionTitleKey = computed(() => titleKeyFor(activeView.value))
const brandTarget = computed(() => locationForView(defaultView(), route))
const showDevEnvironmentNotice = import.meta.env.DEV
const devEnvironmentNoticeKey = import.meta.env.MODE === 'production-remote'
  ? 'environment.productionRemote'
  : 'environment.local'

/** 滚动方向超过这个距离才切换，避免手指轻微抖动让顶栏闪烁。 */
const SCROLL_HYSTERESIS_PX = 8
const hidden = ref(false)
const pinned = computed(() => isWorkspaceView(activeView.value) || props.navOpen)
let lastY = 0
let frame = 0
const onHome = computed(() => activeView.value === 'home')
const scrollY = ref(0)
const overHero = computed(() => onHome.value && scrollY.value < window.innerHeight / 2)

function setHidden(next) {
  hidden.value = next
  if (next) document.documentElement.dataset.topbar = 'hidden'
  else delete document.documentElement.dataset.topbar
}

function onScroll() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const y = Math.max(0, window.scrollY)
    scrollY.value = y
    const header = menuButton.value?.closest('.app-top-bar')?.offsetHeight ?? 0
    if (pinned.value || y <= header) setHidden(false)
    else if (y > lastY + SCROLL_HYSTERESIS_PX) setHidden(true)
    else if (y < lastY - SCROLL_HYSTERESIS_PX) setHidden(false)
    else return
    lastY = y
  })
}

watch(pinned, (value) => { if (value) setHidden(false) })
watch(() => route.fullPath, () => { lastY = 0; scrollY.value = Math.max(0, window.scrollY); setHidden(false) })
onMounted(() => {
  lastY = window.scrollY
  scrollY.value = Math.max(0, lastY)
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  if (frame) cancelAnimationFrame(frame)
  setHidden(false)
})
</script>

<template>
  <header class="app-top-bar" :class="{ 'is-hidden': hidden, 'is-over-hero': overHero }" data-testid="app-top-bar" @focusin="setHidden(false)">
    <button
      ref="menuButton"
      type="button"
      class="menu-button"
      :aria-label="$t('nav.openDrawer')"
      :aria-expanded="navOpen ? 'true' : 'false'"
      aria-haspopup="dialog"
      data-testid="nav-menu"
      @click="emit('open-nav')"
    >
      <Menu :size="22" aria-hidden="true" />
    </button>
    <RouterLink class="brand" :to="brandTarget" aria-label="WoTBTools">
      <BrandMark class="brand-logo" />
    </RouterLink>

    <span v-if="sectionTitleKey" class="section-title">{{ $t(sectionTitleKey) }}</span>

    <span
      v-if="showDevEnvironmentNotice"
      class="dev-notice"
      data-testid="dev-environment-notice"
      role="status"
      :title="$t(devEnvironmentNoticeKey)"
    >{{ $t('environment.label') }}</span>

    <RouterLink v-if="onHome" class="sponsor-link" to="/sponsor" data-testid="nav-sponsor">
      <Heart :size="16" aria-hidden="true" />{{ $t('more.sponsor') }}
    </RouterLink>
    <button
      v-if="openNotifications"
      type="button"
      class="account-link notification-bell"
      :aria-label="unreadCount ? $t('notifications.bellUnread', { count: unreadCount }) : $t('notifications.title')"
      data-testid="nav-notifications"
      @click="openNotifications($event.currentTarget)"
    >
      <Bell :size="20" aria-hidden="true" />
      <span v-if="unreadCount" class="notification-count" aria-hidden="true">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
    </button>
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
  gap: var(--space-2);
  height: calc(var(--header-block) + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) max(var(--space-2), env(safe-area-inset-right)) 0 max(var(--space-1), env(safe-area-inset-left));
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-surface-1);
  transition: transform var(--duration-base) var(--ease-standard);
}

/* 首页首屏：浮在主视觉上 */
.app-top-bar.is-over-hero { border-bottom-color: transparent; background: var(--theme-glass); }

/* L5：收起时整体移出视口（含顶部安全区），焦点进入时立即恢复 */
.app-top-bar.is-hidden { transform: translateY(-100%); }

.menu-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  min-width: var(--hit-min-comfortable);
  min-height: var(--hit-min-comfortable);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
}
.menu-button[aria-expanded="true"] { background: var(--color-surface-2); }
/* 按压反馈（DC-CMP-01 active 状态）：比悬停/展开的 surface-2 深一档；触屏没有 hover，这是按下时唯一的视觉反馈 */
.menu-button:active { background: var(--color-surface-3); }

.brand { display: inline-flex; align-items: center; justify-content: center; flex: none; min-height: var(--control-h-lg); }
.brand-logo { height: 24px; }

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
  min-width: var(--control-h-lg);
  min-height: var(--control-h-lg);
  border-radius: var(--radius-md);
  margin-inline-start: auto;
  color: var(--color-text-secondary);
}

.sponsor-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
  min-height: var(--control-h-lg);
  margin-inline-start: auto;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-full);
  corner-shape: round;
  color: var(--color-accent-text);
  font: var(--type-caption);
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}
/* 窄屏：命中区保持控件高度（触屏 48px），可见的胶囊边框收窄到中间一段，顶栏不再显得拥挤 */
@media (width < 768px) {
  .app-top-bar { gap: var(--space-1); }
  .sponsor-link { position: relative; padding: 0 var(--space-2); border-color: transparent; }
  .sponsor-link::before {
    position: absolute;
    inset: var(--space-2) 0;
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-full);
    corner-shape: round;
    content: "";
    pointer-events: none;
  }
  .account-link { min-width: var(--hit-min-comfortable); }
}
.sponsor-link + .notification-bell,
.sponsor-link + .account-link,
.dev-notice + .sponsor-link { margin-inline-start: 0; }
.sponsor-link:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.notification-bell { position: relative; border: 0; background: transparent; cursor: pointer; }
.notification-bell + .account-link { margin-inline-start: 0; }
.notification-count {
  position: absolute;
  inset-block-start: var(--space-1);
  inset-inline-end: var(--space-1);
  min-inline-size: var(--space-4);
  padding: 0 var(--space-1);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-accent);
  color: var(--color-on-accent);
  font: var(--type-caption);
  font-weight: 700;
  line-height: var(--space-4);
  text-align: center;
}
.account-link.is-active { background: var(--color-surface-2); color: var(--color-accent-text); }

.account-link:focus-visible,
.menu-button:focus-visible,
.brand:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.dev-notice {
  /* 环境标签只是提示：空间不够时省略号收缩，不能把账号入口挤出屏幕 */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-inline-start: auto;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  white-space: nowrap;
}

.dev-notice + .account-link { margin-inline-start: 0; }
</style>
