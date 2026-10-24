/**
 * 遮挡 / 可达性探针：浏览器门禁共用（browser-playback-layout / browser-workspace-interaction）。
 *
 * 规则本身的 canonical owner 是 `docs/frontend/design-language.md` §5「遮挡与可达」。本模块只做
 * 测量与判定，不定义规则；`assertDocumentedLimits()` 反过来断言文档里写的数值与这里一致，
 * 两边任何一侧漂移都会让门禁失败，所以不存在"第二份阈值"。
 *
 * 为什么必须在真实浏览器里测：遮挡是层叠上下文 + containing block + transform + overflow 裁剪
 * 共同决定的绘制结果，可达性是真实 hit-testing 的结果。happy-dom / jsdom 没有布局，
 * `document.elementFromPoint` 恒为 null，正则断言也证明不了「这个选项还点不点得到」。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** 判定口径（见 design-language §5「遮挡与可达」）。 */
export const OCCLUSION_LIMITS = {
  /** 常驻控件与主内容盒的交集上限，占主内容面积的百分比。 */
  maxPrimaryCoveragePct: 5,
  /** 中心保护区：主内容盒居中的这个比例内，常驻控件一律不得压入。 */
  centralBoxFraction: 0.6,
  /** 触控档最小命中区（WCAG 2.5.8 的 24 之上取 Apple HIG / Material 的 44）。 */
  minTouchTargetPx: 44,
  /** 部分裁剪 / 部分覆盖的容差：只放过边框、阴影级别的亚像素误差，超过即不可达。 */
  clipTolerancePx: 2,
}

/**
 * 文档与门禁的反向一致性检查：design-language §5 必须写着同样的数值。
 * 任何一侧改了而另一侧没跟上 → 门禁失败。
 */
export function assertDocumentedLimits() {
  const docPath = resolve(here, '../../docs/frontend/design-language.md')
  const doc = readFileSync(docPath, 'utf8')
  const start = doc.indexOf('### 遮挡与可达')
  if (start < 0) throw new Error('design-language.md 缺少「遮挡与可达」小节：规则 owner 不存在')
  const section = doc.slice(start)
  const failures = []
  const pct = `${OCCLUSION_LIMITS.maxPrimaryCoveragePct}%`
  const central = `${Math.round(OCCLUSION_LIMITS.centralBoxFraction * 100)}%`
  if (!section.includes(`≤ 主内容面积的 ${pct}`)) {
    failures.push(`design-language §5 必须写明主内容遮挡上限为 ${pct}`)
  }
  if (!section.includes(`中心 ${central} 盒`)) {
    failures.push(`design-language §5 必须写明中心保护区为 ${central}`)
  }
  if (!section.includes(`${OCCLUSION_LIMITS.minTouchTargetPx}×${OCCLUSION_LIMITS.minTouchTargetPx}`)) {
    failures.push(`design-language §5 必须写明触控最小命中区为 ${OCCLUSION_LIMITS.minTouchTargetPx}×${OCCLUSION_LIMITS.minTouchTargetPx}`)
  }
  if (!section.includes(`容差 ${OCCLUSION_LIMITS.clipTolerancePx}px`)) {
    failures.push(`design-language §5 必须写明部分裁剪 / 覆盖的容差为 ${OCCLUSION_LIMITS.clipTolerancePx}px`)
  }
  if (failures.length) {
    throw new Error(`occlusion 规则与文档不一致（文档是规则 owner）:\n- ${failures.join('\n- ')}`)
  }
}

/**
 * 页面内探针：自包含（不引用模块作用域），通过 `window.__occlusionInput` 读配置。
 * 返回测量结果 + failures；判定逻辑留在页面里，这样失败信息能直接指出"谁压住了谁、多少像素"。
 */
const occlusionProbe = () => {
  const input = window.__occlusionInput
  const limits = input.limits
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return {
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    }
  }
  const area = (b) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top)
  const intersect = (a, b) => ({
    left: Math.max(a.left, b.left), right: Math.min(a.right, b.right),
    top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom),
  })
  const visible = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const label = (el) => {
    const t = el.getAttribute?.('data-test') || el.getAttribute?.('data-testid')
    return t ? `[${t}]` : `${el.tagName.toLowerCase()}.${(el.className || '').toString().trim().split(/\s+/)[0] || '?'}`
  }

  const primaryEl = document.querySelector(input.primary)
  if (!primaryEl) return { failures: [`primary content not found: ${input.primary}`], items: [] }
  const primary = box(primaryEl)
  const primaryArea = area(primary)
  if (primaryArea <= 0) return { failures: [`primary content has no area: ${input.primary}`], items: [] }

  const cx = (primary.left + primary.right) / 2
  const cy = (primary.top + primary.bottom) / 2
  const halfW = ((primary.right - primary.left) * limits.centralBoxFraction) / 2
  const halfH = ((primary.bottom - primary.top) * limits.centralBoxFraction) / 2
  const central = { left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH }

  const failures = []
  const items = []
  const clipped = []
  for (const selector of input.persistent) {
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el)) continue
      const b = box(el)
      const over = area(intersect(primary, b))
      if (over <= 0) continue
      const centralOver = area(intersect(central, b))
      clipped.push(intersect(primary, b))
      const pct = +((over / primaryArea) * 100).toFixed(2)
      items.push({ selector, label: label(el), rect: b, overPx: +over.toFixed(1), pct, central: centralOver > 0 })
      if (centralOver > 0) {
        failures.push(`常驻控件 ${label(el)} 压入主内容中心 ${Math.round(limits.centralBoxFraction * 100)}% 保护区（交集 ${Math.round(centralOver)} px²）`)
      }
    }
  }
  // 面积取**并集**，不是逐个相加：容器与它的按钮、互相重叠的控件都只能算一次，
  // 否则同一块像素会被重复计数，阈值就失去意义。坐标压缩 + 逐带扫描，矩形很少，够用。
  const xs = [...new Set(clipped.flatMap((r) => [r.left, r.right]))].sort((a, b) => a - b)
  let coveredArea = 0
  for (let i = 0; i < xs.length - 1; i += 1) {
    const x0 = xs[i]
    const x1 = xs[i + 1]
    if (x1 <= x0) continue
    const spans = clipped
      .filter((r) => r.left <= x0 && r.right >= x1)
      .map((r) => [r.top, r.bottom])
      .sort((a, b) => a[0] - b[0])
    let covered = 0
    let cursor = -Infinity
    for (const [top, bottom] of spans) {
      const start = Math.max(top, cursor)
      if (bottom > start) {
        covered += bottom - start
        cursor = bottom
      }
    }
    coveredArea += covered * (x1 - x0)
  }
  const totalPct = +((coveredArea / primaryArea) * 100).toFixed(2)
  if (totalPct > limits.maxPrimaryCoveragePct) {
    failures.push(`常驻控件共遮挡主内容 ${totalPct}%（上限 ${limits.maxPrimaryCoveragePct}%）：${items.map((i) => `${i.label} ${i.pct}%`).join(' + ')}`)
  }
  return { primary, primaryArea: +primaryArea.toFixed(1), totalPct, items, failures }
}

/**
 * 页面内探针：可见选项是否真的可达。
 * 判定「看得见但点不到」：部分或全部被覆盖、被 containing block 链上的 overflow 部分或全部裁掉、
 * pointer-events 穿透、落在视口外且无法滚动触达、命中区过小。中心点露着不算可达。
 */
const reachabilityProbe = () => {
  const input = window.__reachInput
  const limits = input.limits
  const results = []
  const failures = []
  // 实际做了命中采样的选项数：滚出滚动容器的选项会跳过采样，调用方据此防止断言整体空跑
  let sampled = 0
  const label = (el) => {
    const t = el.getAttribute?.('data-test') || el.getAttribute?.('data-testid')
    return t ? `[${t}]` : `${el.tagName.toLowerCase()}.${(el.className || '').toString().trim().split(/\s+/)[0] || '?'}`
  }
  const describe = (el) => {
    if (!el) return null
    const t = el.closest?.('[data-test]')
    const tid = el.closest?.('[data-testid]')
    return (t && `[${t.getAttribute('data-test')}]`) || (tid && `[${tid.getAttribute('data-testid')}]`)
      || `${el.tagName.toLowerCase()}.${(el.className || '').toString().trim().split(/\s+/)[0] || '?'}`
  }
  const visible = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  for (const selector of input.options) {
    const nodes = [...document.querySelectorAll(selector)]
    if (!nodes.length && input.requirePresent !== false) {
      failures.push(`可达性探针找不到选项：${selector}`)
      continue
    }
    for (const el of nodes) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      const name = label(el)
      const tol = limits.clipTolerancePx
      const tag = (node) => `${node.tagName.toLowerCase()}.${(node.className || '').toString().trim().split(/\s+/)[0] || '?'}`
      // 最坏一侧超出 box 多少像素（完全在内 = 0）
      const overhang = (rect, box) => Math.max(0, box.left - rect.left, rect.right - box.right, box.top - rect.top, rect.bottom - box.bottom)

      // 裁剪只沿 **containing block 链**传递（CSS 2 §11.1.1）：`position: fixed / absolute` 的元素
      // 逃出了中间那些祖先，它们的 overflow 裁不到它。按 DOM 父链逐级比较会把 teleport 出去的
      // fixed sheet、绝对定位浮层误判成"被裁掉"。
      const createsContainingBlock = (s) => s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none'
        || (s.backdropFilter && s.backdropFilter !== 'none')
        || /(paint|layout|strict|content)/.test(s.contain || '')
        || /(transform|filter|perspective)/.test(s.willChange || '')
      let fixedToViewport = false
      const containingBlockOf = (node) => {
        const position = getComputedStyle(node).position
        if (position === 'fixed' || position === 'absolute') {
          for (let a = node.parentElement; a && a !== document.documentElement; a = a.parentElement) {
            const s = getComputedStyle(a)
            if (createsContainingBlock(s) || (position === 'absolute' && s.position !== 'static')) return a
          }
          if (position === 'fixed') fixedToViewport = true
          return null
        }
        return node.parentElement === document.documentElement ? null : node.parentElement
      }
      // `<html>` 是 visible 时 body 的 overflow 被提升给视口，body 自己不裁剪
      const bodyOverflowPropagated = getComputedStyle(document.documentElement).overflow === 'visible'

      let probe = { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      let clippedBy = null
      let clippedPx = 0
      let scrolledOutOf = null
      for (let cb = containingBlockOf(el); cb; cb = containingBlockOf(cb)) {
        if (cb === document.body && bodyOverflowPropagated) continue
        const s = getComputedStyle(cb)
        const overflow = `${s.overflowX} ${s.overflowY}`
        if (!/(auto|scroll|hidden|clip)/.test(overflow)) continue
        const cr = cb.getBoundingClientRect()
        // 用 padding box（client box）：边框与滚动条不算可用区
        const box = {
          left: cr.left + cb.clientLeft, top: cr.top + cb.clientTop,
          right: cr.left + cb.clientLeft + cb.clientWidth, bottom: cr.top + cb.clientTop + cb.clientHeight,
        }
        const outside = overhang(probe, box)
        if (outside <= tol) continue
        const scrollable = /(auto|scroll)/.test(overflow)
          && (cb.scrollHeight > cb.clientHeight + 1 || cb.scrollWidth > cb.clientWidth + 1)
        if (scrollable) {
          // 滚出滚动容器 = 可滚动触达；此后真正要求的是**滚动容器本身**不被外层裁掉
          scrolledOutOf = scrolledOutOf || tag(cb)
          probe = box
          continue
        }
        clippedBy = tag(cb)
        clippedPx = Math.round(outside)
        break
      }

      const inFullscreen = !!document.fullscreenElement && document.fullscreenElement.contains(el)
      const docScrolls = !fixedToViewport && !inFullscreen && document.documentElement.scrollHeight > innerHeight + 1
      const viewportBox = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
      const outsideViewport = overhang(probe, viewportBox) > tol
      const reachableByScroll = !!scrolledOutOf || docScrolls

      // 多点采样命中：中心点露着不等于可达。3×3 网格取 1/4 处（落在任何圆角之内），
      // 再加四条边各内收 tol 的中点——底部被盖住 10px 这种只在边缘出现的遮挡也能抓到。
      // 只采视口内、且元素完整在其滚动容器内的情况（滚出去的由上面的滚动判定负责）。
      const occludedAt = []
      const pointerEvents = getComputedStyle(el).pointerEvents
      if (!clippedBy && !scrolledOutOf && pointerEvents !== 'none') {
        sampled += 1
        const w = r.width
        const h = r.height
        const inset = Math.min(tol, w / 4, h / 4)
        const points = []
        for (const fx of [0.25, 0.5, 0.75]) for (const fy of [0.25, 0.5, 0.75]) points.push([r.left + w * fx, r.top + h * fy])
        points.push([r.left + w / 2, r.top + inset], [r.left + w / 2, r.bottom - inset], [r.left + inset, r.top + h / 2], [r.right - inset, r.top + h / 2])
        for (const [px, py] of points) {
          if (px < 0 || py < 0 || px >= innerWidth || py >= innerHeight) continue
          const hit = document.elementFromPoint(px, py)
          // 只有命中元素自身或其后代才算"点得到"。命中祖先 = 指针穿透了它（pointer-events 或自身不可命中），
          // 那不是可达，是这次 review 指出的那个漏判。
          if (hit && (hit === el || el.contains(hit))) continue
          occludedAt.push({ x: Math.round(px - r.left), y: Math.round(py - r.top), hit: describe(hit), ancestor: !!hit && hit.contains(el) })
        }
      }
      const tooSmall = input.touch === true && (r.width < limits.minTouchTargetPx - 0.5 || r.height < limits.minTouchTargetPx - 0.5)
      results.push({
        label: name, rect: { left: +r.left.toFixed(1), top: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        pointerEvents, clippedBy, clippedPx, scrolledOutOf, outsideViewport, reachableByScroll, occludedAt, tooSmall,
      })
      if (pointerEvents === 'none') failures.push(`可见选项 ${name} 的 pointer-events 是 none：看得见但指针到不了`)
      if (clippedBy) failures.push(`可见选项 ${name} 被 containing block ${clippedBy} 的 overflow 裁掉 ${clippedPx}px（容差 ${tol}px）`)
      if (occludedAt.length) {
        const first = occludedAt[0]
        const why = first.ancestor ? `命中落到了祖先 ${first.hit}（自身不可命中）` : `被 ${first.hit} 盖住`
        failures.push(`可见选项 ${name} 有 ${occludedAt.length} 个采样点点不到自身：${why}，首个位置 (${first.x},${first.y})`)
      }
      if (outsideViewport && !reachableByScroll) failures.push(`可见选项 ${name} 落在可用视口外且无法滚动触达（${JSON.stringify({ left: +probe.left.toFixed(1), top: +probe.top.toFixed(1), right: +probe.right.toFixed(1), bottom: +probe.bottom.toFixed(1) })} vs ${innerWidth}x${innerHeight}）`)
      if (tooSmall) failures.push(`可见选项 ${name} 的命中区 ${Math.round(r.width)}×${Math.round(r.height)} 小于触控档 ${limits.minTouchTargetPx}×${limits.minTouchTargetPx}`)
    }
  }
  return { results, failures, sampled }
}

/**
 * 测量常驻控件对主内容的遮挡。
 * @param page browser-page.mjs 的 Page
 * @param primary 主内容选择器（地图 / 表格 / 图表 / 正文容器）
 * @param persistent 常驻控件选择器列表（fixed / sticky / 浮动工具栏 / 底栏 / 侧板）
 */
export async function measureOcclusion(page, { primary, persistent }) {
  await page.evaluate(`window.__occlusionInput = ${JSON.stringify({ primary, persistent, limits: OCCLUSION_LIMITS })}`)
  return page.probe(occlusionProbe)
}

/**
 * 判定可见选项是否真的可达。
 * @param options 选项选择器列表
 * @param touch 触控档（true 时追加 44×44 命中区判定）
 * @param requirePresent 选择器必须有命中元素（默认 true）
 */
export async function measureReachability(page, { options, touch = false, requirePresent = true }) {
  await page.evaluate(`window.__reachInput = ${JSON.stringify({ options, touch, requirePresent, limits: OCCLUSION_LIMITS })}`)
  return page.probe(reachabilityProbe)
}

/**
 * 绘制次序判定：两个元素重叠区的中心点到底命中谁。
 * 这是「瞬态面压过常驻控件」唯一可信的证据——z-index 数值本身证明不了任何事，
 * 因为它只在同一个层叠上下文里可比。
 */
export async function measurePaintOrder(page, { above, below }) {
  await page.evaluate(`window.__paintInput = ${JSON.stringify({ above, below })}`)
  return page.probe(() => {
    const input = window.__paintInput
    const a = document.querySelector(input.above)
    const b = document.querySelector(input.below)
    if (!a || !b) return { failures: [`paint order probe 找不到元素：${!a ? input.above : input.below}`] }
    const ra = a.getBoundingClientRect()
    const rb = b.getBoundingClientRect()
    const left = Math.max(ra.left, rb.left)
    const right = Math.min(ra.right, rb.right)
    const top = Math.max(ra.top, rb.top)
    const bottom = Math.min(ra.bottom, rb.bottom)
    if (right <= left || bottom <= top) {
      return { overlapPx: 0, overlaps: false, failures: [] }
    }
    const x = (left + right) / 2
    const y = (top + bottom) / 2
    const hit = document.elementFromPoint(x, y)
    const aboveWins = !!hit && (a === hit || a.contains(hit))
    const name = (el) => {
      if (!el) return 'null'
      const t = el.closest?.('[data-test]')
      const tid = el.closest?.('[data-testid]')
      return (t && `[${t.getAttribute('data-test')}]`) || (tid && `[${tid.getAttribute('data-testid')}]`)
        || `${el.tagName.toLowerCase()}.${(el.className || '').toString().trim().split(/\s+/)[0] || '?'}`
    }
    return {
      overlaps: true,
      overlapPx: +((right - left) * (bottom - top)).toFixed(1),
      point: { x: +x.toFixed(1), y: +y.toFixed(1) },
      hit: name(hit),
      aboveWins,
      failures: aboveWins ? [] : [`瞬态面 ${input.above} 与 ${input.below} 的重叠区命中 ${name(hit)}：常驻控件盖住了瞬态面`],
    }
  })
}
