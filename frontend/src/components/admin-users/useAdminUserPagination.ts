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
  const jumpPage = ref('')

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

  function jumpTargetPage(raw: string | number, total: number) {
    const value = Number(raw)
    return Number.isInteger(value) && value >= 1 && value <= total ? value : null
  }

  function goJumpPage() {
    const target = jumpTargetPage(jumpPage.value, totalPages.value)
    if (target == null || target - 1 === page.value) return
    if (!requireOnline()) return
    jumpPage.value = ''
    goPage(target - 1)
  }

  return { page, size, totalItems, totalPages, jumpPage, onSizeChange, goPage, jumpTargetPage, goJumpPage }
}
