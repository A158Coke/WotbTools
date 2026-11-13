<script setup lang="ts">
// 名人堂榜单分页条：上一页 / 页码摘要 / 直接跳页 / 下一页。页码本身归所属榜单，这里只持有跳页输入草稿。
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  page: number
  totalPages: number
  totalItems?: number | null
  prevKey: string
  nextKey: string
}>(), { totalItems: null })
const emit = defineEmits<{ go: [page: number] }>()
const { t } = useI18n()
const jumpPage = ref<number | string>('')

function pagerLabel() {
  const { page, totalPages, totalItems } = props
  if (totalItems != null && totalPages > 0) return t('hofPager.summary', { items: totalItems.toLocaleString(), page, total: totalPages })
  if (totalPages > 0) return t('hofPager.pages', { page, total: totalPages })
  return t('hofPager.page', { page })
}

/** 跳页目标：只有 1..totalPages 的整数合法；非法值 / 当前页不发请求，也不清空输入。 */
function goJumpPage() {
  const value = Number(jumpPage.value)
  const valid = Number.isInteger(value) && value >= 1 && value <= props.totalPages
  if (!valid || value === props.page) return
  jumpPage.value = ''
  emit('go', value)
}
</script>

<template>
  <div class="pagination">
    <button v-if="totalPages > 1" type="button" :disabled="page <= 1" @click="emit('go', page - 1)">{{ $t(prevKey) }}</button>
    <span aria-live="polite">{{ pagerLabel() }}</span>
    <span v-if="totalPages > 1" class="page-jump">
      <input
        v-model="jumpPage"
        class="page-jump-input"
        type="number"
        inputmode="numeric"
        min="1"
        :max="totalPages"
        step="1"
        :aria-label="$t('hofPager.jumpLabel')"
        :placeholder="$t('hofPager.jumpPlaceholder')"
        @keydown.enter.prevent="goJumpPage"
      />
      <button type="button" @click="goJumpPage">{{ $t('hofPager.jumpGo') }}</button>
    </span>
    <button v-if="totalPages > 1" type="button" :disabled="page >= totalPages" @click="emit('go', page + 1)">{{ $t(nextKey) }}</button>
  </div>
</template>
