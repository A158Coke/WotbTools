import { ref } from 'vue'
import type { components } from '../../api/generated/http-contract.js'
import { rowOpenTarget } from '../adminListRow'
import * as api from '../../api/admin-users.js'

type AdminUserRow = NonNullable<Awaited<ReturnType<typeof api.adminSearchUsers>>>['items'][number]
type AdminUserDetail = components['schemas']['AdminUserDetail']
type DetailContext = {
  requireOnline: () => boolean
  loadUsers: () => Promise<void>
  showError: (message: string) => void
  apiError: (error: unknown) => string
  isRowControlClick: (event: Event) => boolean
}
type DangerZoneHandle = { reset: () => void }

/**
 * @param {{
 *  requireOnline: () => boolean,
 *  loadUsers: () => Promise<void>,
 *  showError: (message: string) => void,
 *  apiError: (error: unknown) => string,
 *  isRowControlClick: (event: unknown) => boolean,
 * }} ctx
 */
export function useAdminUserDetail({ requireOnline, loadUsers, showError, apiError, isRowControlClick }: DetailContext) {
  const detailRow = ref<AdminUserRow | null>(null)
  const detailUser = ref<AdminUserDetail | null>(null)
  const detailReturnFocus = ref<HTMLElement | null>(null)
  const dangerZone = ref<DangerZoneHandle | null>(null)
  const deleting = ref(false)
  const deleteResult = ref('')
  let detailLoadGeneration = 0
  let deleteCloseTimer: ReturnType<typeof setTimeout> | null = null

  function openDetail(u: AdminUserRow, event?: Event) {
    detailLoadGeneration += 1
    detailReturnFocus.value = event ? rowOpenTarget(event) : null
    detailRow.value = u
    detailUser.value = null
    deleteResult.value = ''
    deleting.value = false
    dangerZone.value?.reset()
    if (!u.keycloakUserMissing) loadDetail(u)
  }

  function onRowClick(u: AdminUserRow, event: Event) {
    if (!isRowControlClick(event)) openDetail(u, event)
  }

  async function loadDetail(u: AdminUserRow) {
    if (!requireOnline()) return
    const generation = ++detailLoadGeneration
    try {
      const result = await api.adminGetUser(u.keycloakUserId)
      if (generation === detailLoadGeneration) detailUser.value = result
    } catch (e) {
      if (generation === detailLoadGeneration) showError(apiError(e))
    }
  }

  function closeDetail() {
    if (deleting.value) return
    detailLoadGeneration += 1
    detailRow.value = null
    detailUser.value = null
    deleteResult.value = ''
  }

  async function confirmDelete() {
    if (!requireOnline()) return
    const target = detailRow.value?.keycloakUserId
    if (!target || deleteResult.value === 'DELETED') return
    deleting.value = true
    deleteResult.value = ''
    try {
      const res = await api.adminDeleteUsers([target], true)
      const item = (res?.results || []).find(r => r.userId === target)
      deleteResult.value = item?.deleted ? 'DELETED' : apiError({ code: item?.errorCode || 'UNKNOWN_ERROR' })
      deleteCloseTimer = setTimeout(() => {
        if (detailRow.value?.keycloakUserId === target) closeDetail()
        loadUsers()
      }, 1200)
    } catch (e) {
      deleteResult.value = apiError(e)
    } finally { deleting.value = false }
  }

  function dispose() {
    detailLoadGeneration += 1
    if (deleteCloseTimer !== null) clearTimeout(deleteCloseTimer)
  }

  return {
    detailRow, detailUser, detailReturnFocus, dangerZone, deleting, deleteResult,
    openDetail, onRowClick, loadDetail, closeDetail, confirmDelete, dispose,
  }
}
