// 管理列表模板「点行打开详情」的两条约定，供各管理列表页共用：
// 1. 行内控件（勾选框、按钮、链接、输入）自己的点击不再触发整行；
// 2. 抽屉关闭后焦点回到该行的打开按钮（.admin-list-open，键盘入口），而不是点行前的 body。

const ROW_CONTROLS = 'button, a, input, label, select, textarea'

export function isRowControlClick(event: Event): boolean {
  return event.target instanceof Element && event.target.closest(ROW_CONTROLS) !== null
}

export function rowOpenTarget(event: Event): HTMLElement | null {
  const row = event.target instanceof Element ? event.target.closest('tr') : null
  return row?.querySelector<HTMLElement>('.admin-list-open') ?? null
}
