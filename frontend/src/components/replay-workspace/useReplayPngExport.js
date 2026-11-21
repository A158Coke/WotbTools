/**
 * ReplayPage —— 赛果 PNG 导出管线（拆分自 ReplayPage.vue，行为原样）。
 * 克隆 DOM → 表格展开/测量 → html2canvas → 下载；失败写回 workspace error。
 */
import { ref } from 'vue'
import { mapLabel } from '../../utils/helpers.js'
import {
  getExportTarget,
  computeExportDimensions,
  exportPngFilename,
  downloadBlob,
  maxFiniteDimension
} from '../../utils/exportReplayPng.js'

function readTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

const EXPORT_THEME_CSS = {
  light: 'replay-export-light',
  dark: 'replay-export-dark'
}

const EXPORT_BG = {
  light: '#ffffff',
  dark: '#1e1e1e'
}

function createExportClone(target, theme) {
  const clone = target.cloneNode(true)
  clone.classList.add('replay-export-root', EXPORT_THEME_CSS[theme])
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-9999px'
  container.style.top = '0'
  container.style.pointerEvents = 'none'
  container.style.zIndex = '-1'
  container.setAttribute('aria-hidden', 'true')
  container.appendChild(clone)
  document.body.appendChild(container)
  return { clone, container }
}

function prepareReplayExportClone(clone) {
  if (!clone) return
  // PNG 总是导出表格：卡片模式下表格只是被隐藏
  for (const el of clone.querySelectorAll('.player-cards')) el.remove()
  for (const el of clone.querySelectorAll('.tablewrap, .scroll-hint')) el.style.display = ''
  for (const el of clone.querySelectorAll('.selected')) {
    el.classList.remove('selected')
  }
  for (const el of clone.querySelectorAll('.sticky-col')) {
    el.style.position = 'static'
    el.style.left = 'auto'
    el.style.right = 'auto'
    el.style.zIndex = 'auto'
  }
}

function expandExportTables(clone) {
  for (const wrap of clone.querySelectorAll('.tablewrap')) {
    wrap.style.overflow = 'visible'
    wrap.style.maxWidth = 'none'
    wrap.style.width = 'max-content'
  }
}

function measureExportClone(clone) {
  const naturalRootW = maxFiniteDimension(
    clone.scrollWidth,
    clone.getBoundingClientRect().width
  )

  let maxDescendantW = 0
  for (const wrap of clone.querySelectorAll('.tablewrap')) {
    const wrapW = maxFiniteDimension(wrap.scrollWidth, wrap.getBoundingClientRect().width)
    if (wrapW > maxDescendantW) maxDescendantW = wrapW
    for (const tbl of wrap.querySelectorAll('table')) {
      const tblW = maxFiniteDimension(tbl.scrollWidth, tbl.getBoundingClientRect().width)
      if (tblW > maxDescendantW) maxDescendantW = tblW
    }
  }
  for (const child of clone.children) {
    const csw = maxFiniteDimension(child.scrollWidth, child.getBoundingClientRect().width)
    if (csw > maxDescendantW) maxDescendantW = csw
  }

  const cs = clone.ownerDocument.defaultView.getComputedStyle(clone)
  const padLeft = parseFloat(cs.paddingLeft) || 0
  const padRight = parseFloat(cs.paddingRight) || 0
  const borderLeft = parseFloat(cs.borderLeftWidth) || 0
  const borderRight = parseFloat(cs.borderRightWidth) || 0
  const hExtra = padLeft + padRight + borderLeft + borderRight

  const requiredW = maxDescendantW > naturalRootW
    ? maxDescendantW + hExtra
    : naturalRootW

  clone.style.width = Math.ceil(requiredW) + 'px'

  const finalW = maxFiniteDimension(clone.scrollWidth, clone.getBoundingClientRect().width)
  const finalH = maxFiniteDimension(clone.scrollHeight, clone.getBoundingClientRect().height)

  return { width: Math.ceil(finalW), height: Math.ceil(finalH) }
}

function waitForLayout(nextTick) {
  return new Promise(resolve => {
    // 等一帧：nextTick 后 requestAnimationFrame
    nextTick().then(() => requestAnimationFrame(resolve))
  })
}

function cleanupExportClone(container) {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container)
  }
}

/**
 * @param {{
 *  loading: import('vue').Ref<boolean>,
 *  error: import('vue').Ref<string>,
 *  isSummaryView: import('vue').ComputedRef<boolean>,
 *  currentSingleIndex: import('vue').ComputedRef<number>,
 *  resp: import('vue').Ref<object|null>,
 *  aggregateRef: import('vue').Ref<HTMLElement|null>,
 *  battleRefs: import('vue').Ref<HTMLElement[]>,
 *  t: (key: string) => string,
 *  locale: import('vue').Ref<string>,
 *  nextTick: () => Promise<void>,
 * }} ctxIn
 */
export function useReplayPngExport(ctxIn) {
  const exportingPng = ref(false)

  async function downloadResultPng() {
    if (exportingPng.value || ctxIn.loading.value) return

    const exportSummary = ctxIn.isSummaryView.value
    const exportBattleIdx = exportSummary ? NaN : ctxIn.currentSingleIndex.value
    const exportTab = exportSummary ? 'aggregate' : `b${exportBattleIdx}`
    const exportTheme = readTheme()
    const exportLocale = ctxIn.locale.value
    const exportMapName = !exportSummary && ctxIn.resp.value?.battles?.[exportBattleIdx]?.mapName
      ? mapLabel(ctxIn.resp.value.battles[exportBattleIdx].mapName, exportLocale)
      : undefined

    const target = getExportTarget(exportTab, ctxIn.aggregateRef.value, ctxIn.battleRefs.value)
    if (!target) return

    let cloneCtx = null

    exportingPng.value = true
    ctxIn.error.value = ''

    try {
      cloneCtx = createExportClone(target, exportTheme)
      prepareReplayExportClone(cloneCtx.clone)
      expandExportTables(cloneCtx.clone)
      await waitForLayout(ctxIn.nextTick)
      const measured = measureExportClone(cloneCtx.clone)
      const dims = computeExportDimensions(measured)

      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(cloneCtx.clone, {
        scale: dims.scale,
        useCORS: true,
        backgroundColor: EXPORT_BG[exportTheme],
        width: dims.width,
        height: dims.height
      })

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Replay PNG export: canvas.toBlob returned null')

      const filename = exportPngFilename(exportTab, isNaN(exportBattleIdx) ? 0 : exportBattleIdx, exportMapName)
      await downloadBlob(blob, filename)
    } catch (e) {
      console.error('[Replay PNG Export] failed', e)
      ctxIn.error.value = ctxIn.t('replay.png_export_failed')
    } finally {
      if (cloneCtx) cleanupExportClone(cloneCtx.container)
      exportingPng.value = false
    }
  }

  return { exportingPng, downloadResultPng }
}
