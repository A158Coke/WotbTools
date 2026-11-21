/**
 * AdminUsersPage —— 行选择集与批量删除确认流（拆分自 AdminUsersPage.vue，行为原样）。
 * 选择集合按「当前页」语义：第一列 = keycloakUserId（后端 deleteOneInternal 的 target）。
 */
import { computed, ref } from 'vue'
import * as api from '../../api/admin-users.js'

/**
 * @param {{
 *  users: import('vue').Ref<Array<{ keycloakUserId: string }>>,
 *  requireOnline: () => boolean,
 *  loadUsers: () => Promise<void>,
 *  showApiError: (error: unknown) => void,
 *  errorText: (error: unknown) => string,
 * }} ctx
 */
export function useAdminUserSelection({ users, requireOnline, loadUsers, showApiError, errorText }) {
  const selectedIds = ref([])
  const selectedSet = computed(() => new Set(selectedIds.value))
  const selectedCount = computed(() => selectedIds.value.length)
  const allPageSelected = computed(() =>
    users.value.length > 0 && users.value.every(u => selectedSet.value.has(u.keycloakUserId)))
  const showBulkConfirm = ref(false)
  const bulkConfirmText = ref('')
  const bulkDeleting = ref(false)
  const bulkResult = ref(null)

  function clearSelection() {
    selectedIds.value = []
  }

  function toggleSelect(u, checked) {
    const next = new Set(selectedIds.value)
    if (checked) next.add(u.keycloakUserId)
    else next.delete(u.keycloakUserId)
    selectedIds.value = [...next]
  }

  function toggleSelectAllPage(checked) {
    const next = new Set(selectedIds.value)
    for (const u of users.value) {
      if (checked) next.add(u.keycloakUserId)
      else next.delete(u.keycloakUserId)
    }
    selectedIds.value = [...next]
  }

  /** 选择集收敛到当前页可见行：不允许「看不见的已选择项」进入批量删除。 */
  function retainVisible() {
    if (selectedIds.value.length) {
      selectedIds.value = selectedIds.value.filter(id => users.value.some(u => u.keycloakUserId === id))
    }
  }

  // 批量删除：整批只弹一次确认，要求输入 DELETE（不逐条弹）。
  function startBulkDelete() {
    if (!selectedCount.value) return
    bulkConfirmText.value = ''
    bulkResult.value = null
    bulkDeleting.value = false
    showBulkConfirm.value = true
  }

  function cancelBulkDelete() {
    showBulkConfirm.value = false
  }

  async function confirmBulkDelete() {
    const ids = [...selectedIds.value]
    if (!ids.length || bulkConfirmText.value !== 'DELETE') return
    // 同单个删除的 TOCTOU：批量确认框可能跨过一次掉线，因此在最后的执行边界再判一次，
    // 非-online 时 adminDeleteUsers 一次都不发。
    if (!requireOnline()) return
    bulkDeleting.value = true
    try {
      const res = await api.adminDeleteUsers(ids, true)
      bulkResult.value = res
      // partial success：只有失败项留在选择集里，成功的整批（无论成功与否）都已被后端处理过。
      const failed = new Set((res?.results || []).filter(r => !r.deleted).map(r => r.userId))
      selectedIds.value = ids.filter(id => failed.has(id))
      bulkConfirmText.value = ''
      await loadUsers()
    } catch (e) {
      showApiError(errorText(e))
    } finally {
      bulkDeleting.value = false
    }
  }

  return {
    selectedIds, selectedSet, selectedCount, allPageSelected,
    showBulkConfirm, bulkConfirmText, bulkDeleting, bulkResult,
    clearSelection, toggleSelect, toggleSelectAllPage, retainVisible,
    startBulkDelete, cancelBulkDelete, confirmBulkDelete,
  }
}
