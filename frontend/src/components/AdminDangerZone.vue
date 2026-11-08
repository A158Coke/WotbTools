<script setup lang="ts">
// 详情抽屉底部的危险操作（管理列表模板）：先点「删除…」展开确认，再点确认才发出 confirm。
// 传 keyword 时还要求原样输入该关键字（用户管理：DELETE）；页面在自己的处理函数里做门禁与请求，
// 本组件只负责两段式确认的交互，不知道删除的是什么。默认插槽放结果 / 警告（确认展开时显示）。
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from './AppButton.vue'

const props = withDefaults(defineProps<{
  /** 起始按钮文案，例如「删除用户」 */
  actionLabel: string
  /** 确认按钮文案；缺省同 actionLabel */
  confirmLabel?: string
  /** 起始态的说明（例如「删除前需输入 DELETE 确认」） */
  hint?: string
  /** 确认态的说明 */
  message?: string
  /** 需要原样输入的关键字；缺省时只要求再点一次确认 */
  keyword?: string
  /** 关键字输入框的标签 */
  keywordLabel?: string
  busy?: boolean
  /** 只禁用起始按钮；已展开的确认不受它影响，最终的联网门禁由页面的确认处理函数在 API 边界判定 */
  disabled?: boolean
}>(), { confirmLabel: '', hint: '', message: '', keyword: '', keywordLabel: '', busy: false, disabled: false })
const emit = defineEmits<{ confirm: [] }>()
const { t } = useI18n()

const armed = ref(false)
const typed = ref('')
const input = ref<HTMLInputElement | null>(null)
const ready = computed(() => !props.keyword || typed.value === props.keyword)

async function arm() {
  armed.value = true
  typed.value = ''
  await nextTick()
  input.value?.focus()
}
function reset() {
  armed.value = false
  typed.value = ''
}
function confirm() {
  if (!ready.value || props.busy) return
  emit('confirm')
}
defineExpose({ reset })
</script>

<template>
  <section class="admin-danger" :aria-label="t('adminList.dangerZone')" data-testid="admin-danger-zone">
    <div v-if="!armed" class="admin-danger-row">
      <span v-if="hint" class="admin-danger-hint">{{ hint }}</span>
      <AppButton variant="danger" class="admin-danger-start" data-testid="admin-danger-start" :disabled="disabled" @click="arm">{{ actionLabel }}</AppButton>
    </div>
    <div v-else class="admin-danger-confirm-panel">
      <p v-if="message" class="admin-danger-message">{{ message }}</p>
      <slot />
      <label v-if="keyword" class="admin-danger-field">
        <span>{{ keywordLabel }}</span>
        <input ref="input" v-model="typed" class="admin-danger-input" data-testid="admin-danger-input" autocomplete="off" autocapitalize="characters" spellcheck="false" :placeholder="keyword" @keydown.enter.prevent="confirm" />
      </label>
      <div class="admin-danger-actions">
        <AppButton variant="ghost" data-testid="admin-danger-cancel" :disabled="busy" @click="reset">{{ t('adminList.cancel') }}</AppButton>
        <AppButton variant="danger" class="admin-danger-confirm" data-testid="admin-danger-confirm" :disabled="!ready || busy" :loading="busy" @click="confirm">{{ confirmLabel || actionLabel }}</AppButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.admin-danger-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
.admin-danger-hint { color: var(--color-text-secondary); font: var(--type-caption); }
.admin-danger-confirm-panel { display: grid; gap: var(--space-3); }
.admin-danger-message { margin: 0; color: var(--color-text-primary); }
.admin-danger-field { display: grid; gap: var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); }
.admin-danger-input {
  box-sizing: border-box;
  width: 100%;
  min-height: var(--control-h-md);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}
.admin-danger-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
</style>
