import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'
import type { useI18n } from 'vue-i18n'

type Translate = ReturnType<typeof useI18n>['t']
type FilterContext = {
  requireOnline: () => boolean
  reloadFirstPage: () => void
  adminAvailability: ComputedRef<{ available: boolean }>
  t: Translate
}

/**
 * @param {{
 *  requireOnline: () => boolean,
 *  reloadFirstPage: () => void,
 *  adminAvailability: import('vue').ComputedRef<{ available: boolean }>,
 *  t: (key: string) => string,
 * }} ctx
 */
export function useAdminUserFilters({ requireOnline, reloadFirstPage, adminAvailability, t }: FilterContext) {
  const segment = ref<'keycloak' | 'local'>('keycloak')
  const idpAlias = ref('')

  function onSegmentChange(value: 'keycloak' | 'local') {
    if (value === segment.value || !requireOnline()) return
    segment.value = value
    if (segment.value !== 'keycloak') idpAlias.value = ''
    reloadFirstPage()
  }

  const segmentOptions = computed(() => [
    { value: 'keycloak', label: t('admin.segmentKeycloak'), testid: 'admin-segment-keycloak', disabled: !adminAvailability.value.available },
    { value: 'local', label: t('admin.segmentLocal'), testid: 'admin-segment-local', disabled: !adminAvailability.value.available },
  ])

  function onIdpAliasChange() {
    reloadFirstPage()
  }

  const filterChips = computed(() => (segment.value === 'keycloak' && idpAlias.value.trim()
    ? [{ key: 'idpAlias', label: `${t('admin.idpAlias')}: ${idpAlias.value.trim()}` }]
    : []))

  function removeFilterChip(key: string) {
    if (key !== 'idpAlias') return
    idpAlias.value = ''
    reloadFirstPage()
  }

  return { segment, idpAlias, onSegmentChange, segmentOptions, onIdpAliasChange, filterChips, removeFilterChip }
}
