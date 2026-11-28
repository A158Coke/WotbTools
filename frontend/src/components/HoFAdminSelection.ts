import { computed, ref, shallowReactive, shallowRef, type Ref } from 'vue'

export const PAGE_SIZES = ['20', '50', '100'].map(value => ({ value, label: value }))

type Translate = (key: string) => string

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
    prune() {
      if (!selected.value.length) return
      selected.value = selected.value.filter(id => rowsRef.value.some(row => row.id === id))
    },
    keepOnly(ids: readonly number[]) { selected.value = [...ids] },
    clear() { selected.value = [] },
  }
}

// Chips describe the last successful result, including when a later request fails.
export function createFilterState<T extends Record<string, string | number | null>>(defaults: T) {
  const draft = shallowReactive({ ...defaults })
  const applied = shallowRef<T>({ ...defaults })
  function without(key: string) {
    if (!Object.hasOwn(defaults, key)) return null
    const field = key as keyof T
    if (draft[field] === applied.value[field]) draft[field] = defaults[field]
    return { ...applied.value, [field]: defaults[field] }
  }
  return { draft, applied, without }
}

export function uniqueValues<T extends string | number>(values: readonly (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((value): value is T => Boolean(value)))].sort()
}

export function battleTypeLabel(t: Translate, tp: string | null | undefined) {
  if (tp === 'RATING') return t('hof.battleType.rating')
  if (tp === 'RANDOM') return t('hof.battleType.random')
  return tp || '-'
}

export function eventChecked(event: Event) {
  return (event.target as HTMLInputElement).checked
}
