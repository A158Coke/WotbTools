
const ROW_CONTROLS = 'button, a, input, label, select, textarea'

export function isRowControlClick(event: Event): boolean {
  return event.target instanceof Element && event.target.closest(ROW_CONTROLS) !== null
}

export function rowOpenTarget(event: Event): HTMLElement | null {
  const row = event.target instanceof Element ? event.target.closest('tr') : null
  return row?.querySelector<HTMLElement>('.admin-list-open') ?? null
}
