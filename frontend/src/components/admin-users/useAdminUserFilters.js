/**
 * AdminUsersPage —— 数据源分段与 IdP 筛选（拆分自 AdminUsersPage.vue，行为原样）。
 * segment=keycloak（Keycloak 权威）| segment=local（本地 user_profile 权威）。
 */
import { computed, ref } from 'vue'

/**
 * @param {{
 *  requireOnline: () => boolean,
 *  reloadFirstPage: () => void,
 *  adminAvailability: import('vue').ComputedRef<{ available: boolean }>,
 *  t: (key: string) => string,
 * }} ctx
 */
export function useAdminUserFilters({ requireOnline, reloadFirstPage, adminAvailability, t }) {
  const segment = ref('keycloak')
  const idpAlias = ref('')

  /**
   * segment=keycloak|local：页头的受控分段（:model-value = 已应用状态）。门禁不通过时不推进已应用值，
   * 分段仍显示上一次真正生效的数据源，绝不出现「显示本地资料、行还是 Keycloak」的假 applied 状态。
   */
  function onSegmentChange(value) {
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

  /** 小屏筛选 chip：只有 IdP 别名一项（数据源在页头，不算筛选）。 */
  const filterChips = computed(() => (segment.value === 'keycloak' && idpAlias.value.trim()
    ? [{ key: 'idpAlias', label: `${t('admin.idpAlias')}: ${idpAlias.value.trim()}` }]
    : []))

  function removeFilterChip(key) {
    if (key !== 'idpAlias') return
    idpAlias.value = ''
    reloadFirstPage()
  }

  return { segment, idpAlias, onSegmentChange, segmentOptions, onIdpAliasChange, filterChips, removeFilterChip }
}
