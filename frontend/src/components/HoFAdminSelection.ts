// 名人堂管理分区共用的小工具：表格选择集、去重排序、战斗类型标签。不持有任何业务状态。
import { computed, ref, type Ref } from 'vue'

type Translate = (key: string) => string

/**
 * 每个表格自己的「全选当前页」选择集；三个分区共用同一份规则，只有 owner（rows ref）不同。
 * 「全选当前页」= 只作用于当前页可见行；每次加载后用 prune() 收敛，不留不可见的选择项。
 */
export function createSelection(rowsRef: Ref<readonly { id: number }[]>) {
  const selected = ref<number[]>([])
  const selectedSet = computed(() => new Set(selected.value))
  return {
    selected,
    count: () => selected.value.length,
    isSelected: (row: { id: number }) => selectedSet.value.has(row.id),
    allSelected: () => rowsRef.value.length > 0 && rowsRef.value.every(row => selectedSet.value.has(row.id)),
    toggle(row: { id: number } | undefined, checked: boolean) {
      if (!row) return
      const next = new Set(selected.value)
      if (checked) next.add(row.id)
      else next.delete(row.id)
      selected.value = [...next]
    },
    toggleAll(checked: boolean) {
      const next = new Set(selected.value)
      for (const row of rowsRef.value) {
        if (checked) next.add(row.id)
        else next.delete(row.id)
      }
      selected.value = [...next]
    },
    /** 每次加载后把选择集收敛到当前列表：翻页/换筛选条件不会留下不可见的选择项。 */
    prune() {
      if (!selected.value.length) return
      selected.value = selected.value.filter(id => rowsRef.value.some(row => row.id === id))
    },
    /** partial success：只保留仍失败的项，便于重试。 */
    keepOnly(ids: readonly number[]) { selected.value = [...ids] },
    clear() { selected.value = [] },
  }
}

export function uniqueValues<T extends string | number>(values: readonly (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((value): value is T => Boolean(value)))].sort()
}

export function battleTypeLabel(t: Translate, tp: string | null | undefined) {
  if (tp === 'RATING') return t('hof.battleType.rating')
  if (tp === 'RANDOM') return t('hof.battleType.random')
  return tp || '-'
}

/** 复选框 change 事件的勾选值。 */
export function eventChecked(event: Event) {
  return (event.target as HTMLInputElement).checked
}
