import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'
import type { useI18n } from 'vue-i18n'

type Translate = ReturnType<typeof useI18n>['t']
type UserFilters = { query: string; segment: 'keycloak' | 'local'; idpAlias: string }
type FilterContext = {
  requireOnline: () => boolean
  applied: ComputedRef<UserFilters>
  reloadFirstPage: (filters: UserFilters) => Promise<boolean>
  removeDisabled: ComputedRef<boolean>
  adminAvailability: ComputedRef<{ available: boolean }>
  t: Translate
}

export function useAdminUserFilters({ requireOnline, applied, reloadFirstPage, removeDisabled, adminAvailability, t }: FilterContext) {
  const segment = computed(() => applied.value.segment)
  const idpAlias = ref('')
  const searchQuery = ref('')

  function draftFor(value: UserFilters['segment']): UserFilters {
    return { query: searchQuery.value, segment: value, idpAlias: value === 'keycloak' ? idpAlias.value.trim() : '' }
  }

  function onSearch() { void reloadFirstPage(draftFor(segment.value)) }

  async function onSegmentChange(value: UserFilters['segment']) {
    if (value === segment.value || !requireOnline()) return
    const previousAlias = idpAlias.value
    if (await reloadFirstPage(draftFor(value)) && value === 'local' && idpAlias.value === previousAlias) idpAlias.value = ''
  }

  const segmentOptions = computed(() => [
    { value: 'keycloak', label: t('admin.segmentKeycloak'), testid: 'admin-segment-keycloak', disabled: !adminAvailability.value.available },
    { value: 'local', label: t('admin.segmentLocal'), testid: 'admin-segment-local', disabled: !adminAvailability.value.available },
  ])

  const filterChips = computed(() => (applied.value.idpAlias
    ? [{ key: 'idpAlias', label: `${t('admin.idpAlias')}: ${applied.value.idpAlias}` }]
    : []))

  function removeFilterChip(key: string) {
    if (key !== 'idpAlias' || removeDisabled.value || !applied.value.idpAlias || !requireOnline()) return
    if (idpAlias.value.trim() === applied.value.idpAlias) idpAlias.value = ''
    reloadFirstPage({ ...applied.value, idpAlias: '' })
  }

  return { segment, idpAlias, searchQuery, onSearch, onSegmentChange, segmentOptions, filterChips, removeFilterChip }
}
