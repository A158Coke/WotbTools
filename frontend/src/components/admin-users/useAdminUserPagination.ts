/**
 * AdminUsersPage —— 服务端分页状态与翻页动作（拆分自 AdminUsersPage.vue，行为原样）。
 * page 为 0-based（与后端一致），UI 显示时 +1；跳页输入是 UI 页码（1-based）。
 */
import { ref } from 'vue'

/** @param {{ requireOnline: () => boolean, clearSelection: () => void, loadUsers: () => Promise<void>, reloadFirstPage: () => void }} ctx */
type PaginationContext = {
  requireOnline: () => boolean
  clearSelection: () => void
  loadUsers: () => Promise<void>
  reloadFirstPage: () => void
}

export function useAdminUserPagination({ requireOnline, clearSelection, loadUsers, reloadFirstPage }: PaginationContext) {
  const page = ref(0)
  const size = ref(25)
  const totalItems = ref(0)
  const totalPages = ref(0)
  // 跳页输入是 UI 页码（1-based）；只有合法的 1..totalPages 才转换成后端 0-based page。
  const jumpPage = ref('')

  /** 每页数量：未通过门禁（或值非法）时保持已应用的 size。 */
  function onSizeChange(event: Event) {
    const target = event.target instanceof HTMLSelectElement ? event.target : null
    const next = Number(target?.value)
    if (!requireOnline() || !Number.isFinite(next)) {
      if (target) target.value = target.dataset.appliedValue ?? ''
      return
    }
    size.value = next
    reloadFirstPage()
  }

  function goPage(nextPage: number) {
    if (!requireOnline()) return
    if (nextPage < 0 || nextPage === page.value) return
    if (totalPages.value > 0 && nextPage > totalPages.value - 1) return
    clearSelection()
    page.value = nextPage
    loadUsers()
  }

  /** 跳页目标：只有 1..totalPages 的整数合法（空值 / 非整数 / 越界返回 null，调用方据此不发请求）。 */
  function jumpTargetPage(raw: string | number, total: number) {
    const value = Number(raw)
    return Number.isInteger(value) && value >= 1 && value <= total ? value : null
  }

  /**
   * 直接跳页：UI 1-based → 后端 0-based。
   * 门禁先于状态变更（与 search / segment / size 同一约定）：非-online 时不改已应用页码、不发请求；
   * 选择集清空沿用 goPage() 内的 clearSelection()。
   */
  function goJumpPage() {
    const target = jumpTargetPage(jumpPage.value, totalPages.value)
    if (target == null || target - 1 === page.value) return
    if (!requireOnline()) return
    jumpPage.value = ''
    goPage(target - 1)
  }

  return { page, size, totalItems, totalPages, jumpPage, onSizeChange, goPage, jumpTargetPage, goJumpPage }
}
