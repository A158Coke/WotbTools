/**
 * AdminUsersPage —— 详情抽屉状态与删除流（拆分自 AdminUsersPage.vue，行为原样）。
 * 点行立即打开，先显示列表行自带的字段；Keycloak 仍存在的用户再补拉详情（detailUser）。
 * 删除只在抽屉底部（AdminDangerZone，输入 DELETE），目标就是抽屉里这一行。
 */
import { ref } from 'vue'
import { rowOpenTarget } from '../adminListRow'
import * as api from '../../api/admin-users.js'

/**
 * @param {{
 *  requireOnline: () => boolean,
 *  loadUsers: () => Promise<void>,
 *  showError: (message: string) => void,
 *  apiError: (error: unknown) => string,
 *  isRowControlClick: (event: unknown) => boolean,
 * }} ctx
 */
export function useAdminUserDetail({ requireOnline, loadUsers, showError, apiError, isRowControlClick }) {
  const detailRow = ref(null)
  const detailUser = ref(null)
  const detailReturnFocus = ref(null)
  const dangerZone = ref(null)
  const deleting = ref(false)
  const deleteResult = ref('')
  let detailLoadGeneration = 0
  let deleteCloseTimer = null

  /**
   * 点行 / 行的打开按钮：抽屉立即打开并显示列表行字段；Keycloak 已删除的用户没有详情可拉，
   * 抽屉只显示行字段与说明（删除仍可用，与原来「查看禁用、删除可用」一致）。
   * 详情请求走门禁：非-online 时不发 adminGetUser。
   */
  function openDetail(u, event) {
    detailLoadGeneration += 1
    detailReturnFocus.value = event ? rowOpenTarget(event) : null
    detailRow.value = u
    detailUser.value = null
    deleteResult.value = ''
    deleting.value = false
    dangerZone.value?.reset()
    if (!u.keycloakUserMissing) loadDetail(u)
  }

  function onRowClick(u, event) {
    if (!isRowControlClick(event)) openDetail(u, event)
  }

  async function loadDetail(u) {
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
    // 删除请求在途时不关（与原确认框同一约定）：结果要能被看到，且不允许在途中换目标。
    if (deleting.value) return
    detailLoadGeneration += 1
    detailRow.value = null
    detailUser.value = null
    deleteResult.value = ''
  }

  async function confirmDelete() {
    // TOCTOU：抽屉可以在「在线」时打开、在「离线」后才确认，所以判定必须放在
    // 真正的 API boundary（而不是只放在打开抽屉时）；否则离线时仍会发出破坏性请求。
    if (!requireOnline()) return
    const target = detailRow.value?.keycloakUserId
    if (!target || deleteResult.value === 'DELETED') return
    deleting.value = true
    deleteResult.value = ''
    try {
      // 单条删除就是长度为 1 的列表：与多选删除走同一个端点。
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
    clearTimeout(deleteCloseTimer)
  }

  return {
    detailRow, detailUser, detailReturnFocus, dangerZone, deleting, deleteResult,
    openDetail, onRowClick, loadDetail, closeDetail, confirmDelete, dispose,
  }
}
