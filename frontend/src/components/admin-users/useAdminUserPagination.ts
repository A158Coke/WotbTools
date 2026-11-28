import { ref, type ComputedRef } from 'vue'

type PaginationContext = {
  requireOnline: () => boolean
  page: ComputedRef<number>
  size: ComputedRef<number>
  totalPages: ComputedRef<number>
  requestPage: (page: number, size: number) => void
}

export function useAdminUserPagination({ requireOnline, page, size, totalPages, requestPage }: PaginationContext) {
  const jumpPage = ref('')

  function onSizeChange(value: string) {
    if (!requireOnline()) return
    requestPage(0, Number(value))
  }

  function goPage(nextPage: number) {
    if (!requireOnline()) return
    if (nextPage < 0 || nextPage === page.value) return
    if (totalPages.value > 0 && nextPage > totalPages.value - 1) return
    requestPage(nextPage, size.value)
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

  return { jumpPage, onSizeChange, goPage, jumpTargetPage, goJumpPage }
}
