<script setup lang="ts">
// 本机通知中心面板（design-language §10「反馈」）：复用 AppSheet；打开即看到最近 20 条，可一键全部已读。
// 点一条通知：标记已读并去它关联的页面（若有）。
import { inject } from 'vue'
import AppSheet from '../components/AppSheet.vue'
import { markAllRead, markRead, notifications, unreadCount } from '../composables/useNotifications.js'
import type { AppNotification } from '../composables/useNotifications.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'

defineProps<{ open: boolean, returnFocusTo?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()
const navigate = inject(NAVIGATE_VIEW_KEY, null)

function openItem(item: AppNotification) {
  markRead(item.id)
  if (item.view && navigate) {
    emit('close')
    void navigate(item.view)
  }
}

function timeLabel(at: number, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at)
}
</script>

<template>
  <AppSheet :open="open" :title="$t('notifications.title')" :return-focus-to="returnFocusTo" data-testid="notification-panel" @close="emit('close')">
    <header class="notification-head">
      <h2 class="notification-title">{{ $t('notifications.title') }}<span v-if="unreadCount"> · {{ $t('notifications.unread', { count: unreadCount }) }}</span></h2>
      <button v-if="unreadCount" type="button" class="notification-read-all" data-testid="notifications-read-all" @click="markAllRead">{{ $t('notifications.readAll') }}</button>
    </header>
    <p v-if="!notifications.length" class="notification-empty" data-testid="notifications-empty">{{ $t('notifications.empty') }}</p>
    <ul v-else class="notification-list">
      <li v-for="item in notifications" :key="item.id">
        <button type="button" class="notification-item" :class="{ 'is-unread': !item.read }" :data-testid="`notification-${item.kind}`" @click="openItem(item)">
          <span class="notification-dot" aria-hidden="true" />
          <span class="notification-text">
            <strong>{{ $t(item.titleKey, item.params ?? {}) }}</strong>
            <span v-if="item.bodyKey">{{ $t(item.bodyKey, item.params ?? {}) }}</span>
          </span>
          <time class="notification-time" :datetime="new Date(item.at).toISOString()">{{ timeLabel(item.at, $i18n.locale) }}</time>
        </button>
      </li>
    </ul>
  </AppSheet>
</template>

<style scoped>
.notification-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-block-end: var(--space-2); }
.notification-title { margin: 0; font: var(--type-h3); }
.notification-read-all { min-block-size: var(--hit-min-comfortable); padding: 0 var(--space-2); border: 0; background: transparent; color: var(--color-accent-text); font: var(--type-body); cursor: pointer; }
.notification-empty { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }
.notification-list { display: grid; margin: 0; padding: 0; list-style: none; }
.notification-item {
  display: grid;
  grid-template-columns: var(--space-2) minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--space-3);
  inline-size: 100%;
  min-block-size: var(--hit-min-comfortable);
  padding: var(--space-3) 0;
  border: 0;
  border-block-end: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  cursor: pointer;
}
.notification-dot { inline-size: var(--space-2); block-size: var(--space-2); margin-block-start: var(--space-2); border-radius: var(--radius-full); corner-shape: round; }
.notification-item.is-unread .notification-dot { background: var(--color-accent); }
.notification-text { display: grid; gap: var(--space-1); min-inline-size: 0; overflow-wrap: anywhere; }
.notification-text span { color: var(--color-text-secondary); font: var(--type-caption); }
.notification-time { color: var(--color-text-tertiary); font: var(--type-caption); white-space: nowrap; }
.notification-item:focus-visible,
.notification-read-all:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
</style>
