import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import type { components } from '../../api/generated/http-contract.js'
import * as api from '../../api/admin-users.js'

type AdminUserRow = components['schemas']['AdminUserPage']['items'][number]
type SelectionContext = {
  users: Ref<AdminUserRow[]>
  requireOnline: () => boolean
  loadUsers: () => Promise<void>
  showApiError: (message: string) => void
  errorText: (error: unknown) => string
}

/**
 * @param {{
 *  users: import('vue').Ref<Array<{ keycloakUserId: string }>>,
 *  requireOnline: () => boolean,
 *  loadUsers: () => Promise<void>,
 *  showApiError: (error: unknown) => void,
 *  errorText: (error: unknown) => string,
 * }} ctx
 */
export function useAdminUserSelection({ users, requireOnline, loadUsers, showApiError, errorText }: SelectionContext) {
  const selectedIds = ref<string[]>([])
  const selectedSet = computed(() => new Set(selectedIds.value))
  const selectedCount = computed(() => selectedIds.value.length)
  const allPageSelected = computed(() =>
    users.value.length > 0 && users.value.every(u => selectedSet.value.has(u.keycloakUserId)))
  const showBulkConfirm = ref(false)
  const bulkConfirmText = ref('')
  const bulkDeleting = ref(false)
  const bulkResult = ref<Awaited<ReturnType<typeof api.adminDeleteUsers>> | null>(null)

  function clearSelection() {
    selectedIds.value = []
  }

  function toggleSelect(u: AdminUserRow, checked: boolean) {
    const next = new Set(selectedIds.value)
    if (checked) next.add(u.keycloakUserId)
    else next.delete(u.keycloakUserId)
    selectedIds.value = [...next]
  }

  function toggleSelectAllPage(checked: boolean) {
    const next = new Set(selectedIds.value)
    for (const u of users.value) {
      if (checked) next.add(u.keycloakUserId)
      else next.delete(u.keycloakUserId)
    }
    selectedIds.value = [...next]
  }

  function retainVisible() {
    if (selectedIds.value.length) {
      selectedIds.value = selectedIds.value.filter(id => users.value.some(u => u.keycloakUserId === id))
    }
  }

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
    if (!requireOnline()) return
    bulkDeleting.value = true
    try {
      const res = await api.adminDeleteUsers(ids, true)
      bulkResult.value = res
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
