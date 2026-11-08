<script setup lang="ts">
// 管理列表模板的详情抽屉：点行在右侧打开（AppSheet side="end"：焦点陷阱、Esc、遮罩、右滑关闭、安全区），
// 不再弹模态框。头部是标题 + 关闭，主体独立滚动（overscroll 不传到背景，DC-RSP-09），
// footer 插槽固定在底部，放危险操作（AdminDangerZone）。
import { X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import AppSheet from './AppSheet.vue'

defineProps<{
  open: boolean
  title: string
  /** 关闭后焦点回到的元素；缺省回到打开前的焦点元素（点行时为该行的打开按钮） */
  returnFocusTo?: HTMLElement | null
}>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
</script>

<template>
  <AppSheet :open="open" :title="title" side="end" :return-focus-to="returnFocusTo" data-testid="admin-detail-drawer" @close="emit('close')">
    <div class="admin-drawer-head">
      <strong class="admin-drawer-title" aria-hidden="true">{{ title }}</strong>
      <button type="button" class="admin-drawer-close" data-testid="admin-drawer-close" :aria-label="t('adminList.close')" @click="emit('close')">
        <X :size="20" aria-hidden="true" />
      </button>
    </div>
    <div class="admin-drawer-body"><slot /></div>
    <div v-if="$slots.footer" class="admin-drawer-foot"><slot name="footer" /></div>
  </AppSheet>
</template>

<style scoped>
.admin-drawer-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: calc(var(--control-h-lg) + var(--space-6));
  padding: 0 var(--space-3) 0 var(--space-6);
  border-bottom: 1px solid var(--color-border-subtle);
}
.admin-drawer-title { min-width: 0; font: var(--type-h3); overflow-wrap: anywhere; }
.admin-drawer-close {
  display: inline-grid;
  flex: none;
  place-items: center;
  min-width: var(--hit-min-comfortable);
  min-height: var(--hit-min-comfortable);
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.admin-drawer-body { flex: 1 1 auto; min-height: 0; padding: var(--space-5) var(--space-6); overflow-y: auto; overscroll-behavior: contain; }
.admin-drawer-foot { flex: none; padding: var(--space-4) var(--space-6); border-top: 1px solid var(--color-border-subtle); }
@media (hover: hover) {
  .admin-drawer-close:hover { background: var(--color-surface-2); color: var(--color-text-primary); }
}
@media (width < 768px) {
  .admin-drawer-head { padding-inline-start: var(--gutter); }
  .admin-drawer-body,
  .admin-drawer-foot { padding-inline: var(--gutter); }
}
</style>
