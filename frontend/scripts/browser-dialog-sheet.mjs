import { Page, delay } from './browser-page.mjs'
import { measurePaintOrder, measureReachability } from './browser-occlusion.mjs'

export const DIALOG_SHEET_SCENARIOS = [...['summer', 'winter'].flatMap(profile => [
  { width: 390, height: 844, touch: true },
  { width: 740, height: 360, touch: true },
  { width: 1024, height: 768, touch: true },
  { width: 1440, height: 900, touch: false },
].map(size => ({ ...size, profile, name: `dialog-sheet-${profile}-${size.width}x${size.height}` }))),
{ width: 740, height: 360, touch: true, profile: 'summer', name: 'dialog-sheet-summer-740x360-safe-area',
  safeAreaInsets: { top: 24, bottom: 20, left: 12, right: 12 } },
]

/** 真实组件边界：背景常驻层 + 长表单 + 嵌套 dialog；不替换 Reka 的 portal/焦点/滚动。 */
export async function runDialogSheetScenario(env, scenario) {
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  const failures = []
  const check = (ok, message) => { if (!ok) failures.push(message) }
  const waitClosed = selector => page.waitForValue(`!document.querySelector(${JSON.stringify(selector)})`, Boolean)
  async function tap(selector, rightEdge = false) {
    await page.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`, Boolean)
    await page.animationsSettled()
    await page.callWith((sel) => document.querySelector(sel).scrollIntoView({ block: 'nearest', inline: 'nearest' }), selector)
    const reach = await measureReachability(page, { options: [selector], touch: scenario.touch !== false })
    check(reach.sampled > 0, `可达性断言空跑：${selector}`)
    failures.push(...reach.failures)
    if (reach.failures.length) throw new Error(`控件不可达：${selector}`)
    if (scenario.safeAreaInsets) {
      const safe = await page.callWith((sel, inset) => {
        const r = document.querySelector(sel).getBoundingClientRect()
        return r.left >= inset.left && r.right <= innerWidth - inset.right
          && r.top >= inset.top && r.bottom <= innerHeight - inset.bottom
      }, selector, scenario.safeAreaInsets)
      check(safe, `控件侵入安全区：${selector}`)
    }
    const point = await page.callWith((sel, edge) => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return { x: edge ? r.right - 2 : r.left + r.width / 2, y: r.top + r.height / 2 }
    }, selector, rightEdge)
    await page.tap({ ...point, touch: scenario.touch })
  }
  async function escape() {
    for (const type of ['keyDown', 'keyUp']) await env.chrome.client.send('Input.dispatchKeyEvent', {
      type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
    }, sessionId)
  }
  async function checkSurface(selector, scrollSelector) {
    await page.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`, Boolean)
    await page.animationsSettled()
    const bounds = await page.evaluate(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)}), body=el.querySelector(${JSON.stringify(scrollSelector)}), r=el.getBoundingClientRect(), b=body.getBoundingClientRect()
      return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,
        bodyTop:b.top,bodyBottom:b.bottom,scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,
        focused:el.contains(document.activeElement) }
    })()`)
    check(bounds.left >= -1 && bounds.right <= bounds.width + 1 && bounds.top >= -1 && bounds.bottom <= bounds.height + 1,
      `${selector} 越出视口：${JSON.stringify(bounds)}`)
    check(bounds.bodyTop >= bounds.top - 1 && bounds.bodyBottom <= bounds.bottom + 1,
      `${selector} 的滚动区被面板裁切：${JSON.stringify(bounds)}`)
    check(bounds.scrollHeight > bounds.clientHeight, `${selector} 长内容未形成内部滚动区`)
    check(bounds.focused, `${selector} 打开后焦点未进入`)
    const order = await measurePaintOrder(page, { above: selector, below: '[data-testid=persistent-footer]' })
    check(order.overlaps, `${selector} 与常驻底栏未重叠，层级检查空跑`)
    failures.push(...order.failures)
  }

  try {
    await page.enable()
    await page.emulate(scenario)
    if (scenario.safeAreaInsets) await env.chrome.client.send('Emulation.setSafeAreaInsetsOverride', { insets: scenario.safeAreaInsets }, sessionId)
    await page.goto(`${env.origin}/scripts/browser-fixtures/dialog-sheet.html?profile=${scenario.profile}`)
    for (const visibleTitle of [false, true]) {
      const opener = `[data-testid=open-sheet-${visibleTitle ? 'visible' : 'hidden'}]`
      await tap(opener)
      await checkSurface('[data-testid=test-sheet]', '.sheet-body')
      for (const index of [19, 0]) {
        await tap(`[data-testid=sheet-row-${index}]`)
        await page.waitForValue('document.querySelector("[data-testid=overlay-selected]").textContent', value => value === `sheet-row-${index}`)
      }
      // 与筛选面板同形态的右对齐按钮：滚动条不能占用按钮右缘的触摸命中。
      if (visibleTitle) await tap('[data-testid=sheet-done]', true)
      else await escape()
      await waitClosed('[data-testid=test-sheet]')
      await page.waitForValue(`document.activeElement === document.querySelector(${JSON.stringify(opener)})`, Boolean)
      await page.waitForValue('getComputedStyle(document.body).pointerEvents !== "none"', Boolean)
    }

    await tap('[data-testid=open-dialog]')
    await checkSurface('[data-testid=outer-dialog]', '.dialog-body')
    await tap('[data-testid=dialog-row-19]')
    await page.waitForValue('document.querySelector("[data-testid=overlay-selected]").textContent', value => value === 'dialog-row-19')
    await tap('[data-testid=open-nested-dialog]')
    await page.waitForValue('!!document.querySelector("[data-testid=nested-dialog]")', Boolean)
    await page.animationsSettled()
    const nested = await measurePaintOrder(page, { above: '[data-testid=nested-dialog]', below: '[data-testid=outer-dialog]' })
    check(nested.overlaps, '嵌套 dialog 与父 dialog 未重叠，层级检查空跑')
    failures.push(...nested.failures)
    await tap('[data-testid=nested-select]')
    await waitClosed('[data-testid=nested-dialog]')
    await page.waitForValue('document.activeElement?.dataset.testid', value => value === 'open-nested-dialog')

    // 可控遮挡只进入测试页面：探针必须拒绝看似存在却点不到的完成按钮。
    await page.evaluate(`(() => { const blocker=document.createElement('div'); blocker.id='occlusion-negative-control'; blocker.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:auto'; document.body.append(blocker) })()`)
    const negative = await measureReachability(page, { options: ['[data-testid=dialog-done]'], touch: scenario.touch !== false })
    check(negative.sampled > 0 && negative.failures.length > 0 && negative.results.some(value => value.occludedAt.length > 0),
      `探针未检测故意注入的遮挡：${JSON.stringify(negative)}`)
    await page.evaluate('document.getElementById("occlusion-negative-control").remove()')
    await tap('[data-testid=dialog-done]')
    await waitClosed('[data-testid=outer-dialog]')
    await page.waitForValue('document.activeElement?.dataset.testid', value => value === 'open-dialog')
    await page.waitForValue('getComputedStyle(document.body).pointerEvents !== "none"', Boolean)
    await tap('[data-testid=open-dialog]')
    await tap('[data-testid=outer-dialog] .dialog-close')
    await waitClosed('[data-testid=outer-dialog]')
  } catch (error) {
    failures.push(error.message, ...await page.diagnose())
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId }).catch(() => {})
  }
  return { name: scenario.name, failures: [...failures, ...page.consoleErrors], viewport: `${scenario.width}x${scenario.height}` }
}

/* ------------------------------------------------------------------ F-04 抽屉退出连续性（真实应用 + 真实 touch 输入）
 *
 * 验证 nav 抽屉（AppSheet side="start"）的关闭生命周期，而不只看「视觉上消失」：
 * - Escape / swipe dismiss 后 DrawerContent、遮罩、DismissableLayer 真实卸载（Presence 等 animationend）
 * - swipe 退场从释放位置继续（不跳回），时长随 --drawer-swipe-strength 缩放（快甩 < 慢甩 < 普通关闭）
 * - 未达阈值回弹、退出中重开无残留、reduced-motion 不等待动画
 * - 关闭后底层按钮恢复可点击（无 invisible click blocker）
 *
 * 已知限制：happy-dom 单测无法生成真实 touch/动画时间线，真实 Swipe 验收只能在这里做。 */
export const DRAWER_EXIT_SCENARIOS = [
  { name: 'drawer-exit-nav-390x844', width: 390, height: 844, touch: true, profile: 'summer' },
  { name: 'drawer-exit-nav-reduced-390x844', width: 390, height: 844, touch: true, profile: 'summer', reducedMotion: true },
]

export async function runDrawerExitScenario(env, scenario) {
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  const failures = []
  const check = (ok, message) => { if (!ok) failures.push(message) }
  const send = (method, params) => env.chrome.client.send(method, params, sessionId)
  const drawerOpen = () => page.callWith(() => {
    const el = document.querySelector('[data-testid="nav-drawer"]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { state: el.dataset.state, x: r.x, dismissed: el.hasAttribute('data-swipe-dismissed'),
      swipeX: el.style.getPropertyValue('--drawer-swipe-movement-x') }
  })
  const scrimPresent = () => page.callWith(() => !!document.querySelector('[data-testid="sheet-scrim"]'))
  const waitClosed = label => page.waitForValue('!document.querySelector("[data-testid=nav-drawer]")', Boolean, { label })
  const waitScrimGone = () => page.waitForValue('!document.querySelector("[data-testid=sheet-scrim]")', Boolean, { timeout: 3000, label: 'scrim unmount' })

  async function openDrawer() {
    await page.tapSelector('[data-testid=nav-menu]')
    await page.waitForValue('!!document.querySelector("[data-testid=nav-drawer-panel]")', Boolean, { label: 'drawer open' })
    await page.animationsSettled()
  }
  /** 一次性在页面内计时：dispatch Escape → rAF 轮询到 DrawerContent 卸载，返回耗时 ms（未卸载返回 -1） */
  async function escapeAndMeasure() {
    return page.callWith(() => new Promise(resolve => {
      const started = performance.now()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      const tick = () => {
        if (!document.querySelector('[data-testid="nav-drawer"]')) { resolve(performance.now() - started); return }
        if (performance.now() - started > 5000) { resolve(-1); return }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }))
  }
  /** 真实 CDP touch 拖动：dx 位移、spanMs 总时长 */
  async function swipeDrag(dx, spanMs) {
    const p0 = await page.callWith(() => {
      const r = document.querySelector('[data-testid="nav-drawer"]').getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 300) }
    })
    const steps = Math.max(4, Math.round(spanMs / 16))
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p0.x, y: p0.y, id: 1 }] })
    for (let i = 1; i <= steps; i++) {
      await delay(spanMs / steps)
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p0.x + (dx * i) / steps, y: p0.y, id: 1 }] })
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  /** swipe 释放后计时到卸载（页面内 rAF 轮询），返回 { ms, releaseX, released } */
  async function measureSwipeExit(dx, spanMs) {
    await swipeDrag(dx, spanMs)
    const release = await drawerOpen()
    const ms = await page.callWith(() => new Promise(resolve => {
      const started = performance.now()
      const tick = () => {
        if (!document.querySelector('[data-testid="nav-drawer"]')) { resolve(performance.now() - started); return }
        if (performance.now() - started > 5000) { resolve(-1); return }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }))
    return { ms, releaseX: release?.x ?? null, released: release != null }
  }
  const escapeKey = () => page.callWith(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })

  try {
    await page.enable()
    await page.emulate(scenario)
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('wotb-lang','zh');localStorage.setItem('wotb-ui-profile','${scenario.profile ?? 'summer'}')` })
    if (scenario.reducedMotion) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    }
    await page.goto(`${env.origin}/`)
    await page.waitForValue(`!!document.querySelector('[data-testid=app-top-bar]') || !!document.querySelector('[data-testid=app-sidebar]')`, Boolean, { label: 'shell ready' })

    await openDrawer()
    const opened = await drawerOpen()
    check(opened && opened.state === 'open' && opened.x > -1, `抽屉打开态异常：${JSON.stringify(opened)}`)
    check(await scrimPresent(), '打开时遮罩存在')

    // 1) 普通关闭：正常退出并卸载，遮罩一起消失；底层按钮恢复可点（真实 touch 再开抽屉）
    const escapeMs = await escapeAndMeasure()
    check(escapeMs > 0 && escapeMs < 2000, `Escape 关闭未在时限内卸载：${escapeMs}ms`)
    if (!scenario.reducedMotion) check(escapeMs >= 60, `Escape 关闭疑似无退场动画（过快）：${escapeMs}ms`)
    await waitScrimGone()
    check(!(await scrimPresent()), 'Escape 关闭后遮罩残留')
    await page.tapSelector('[data-testid=nav-menu]')
    await page.waitForValue('!!document.querySelector("[data-testid=nav-drawer-panel]")', Boolean, { label: 'underlying click reopens drawer' })
    await page.animationsSettled()
    await escapeKey()
    await waitClosed('escape close #2 unmount')
    check(!(await scrimPresent()), '第二次关闭后遮罩残留')

    // 2-3) swipe dismiss 时长缩放只在有动画时有意义；reduced-motion 下无空间退场
    if (!scenario.reducedMotion) {
      // 慢速 swipe dismiss：正常退出，不异常延长（≤ 普通关闭时长 + 余量）
      await openDrawer()
      const slow = await measureSwipeExit(-170, 210)
      check(slow.released, `慢速 swipe 未进入退场（释放时元素已不在）：${JSON.stringify(slow)}`)
      check(slow.ms > 0, `慢速 swipe 关闭未在时限内卸载：${slow.ms}ms`)
      check(slow.ms <= escapeMs + 120, `慢速 swipe 退场异常延长：${slow.ms}ms > escape ${escapeMs}ms + 120ms`)
      await waitScrimGone()
      check(!(await scrimPresent()), '慢速 swipe 关闭后遮罩残留')

      // 快速 swipe dismiss：退场时长明显短于慢速 swipe（strength 乘法缩放）
      await openDrawer()
      const fast = await measureSwipeExit(-260, 60)
      check(fast.released, `快速 swipe 未进入退场：${JSON.stringify(fast)}`)
      check(fast.ms > 0 && fast.ms < 2000, `快速 swipe 关闭未在时限内卸载：${fast.ms}ms`)
      check(fast.ms < slow.ms - 20, `快甩退场未短于慢甩：fast=${fast.ms}ms slow=${slow.ms}ms`)
      console.log(`[drawer-exit] exit durations: escape=${Math.round(escapeMs)}ms slow-swipe=${Math.round(slow.ms)}ms fast-swipe=${Math.round(fast.ms)}ms (releaseX slow=${Math.round(slow.releaseX)} fast=${Math.round(fast.releaseX)})`)
      await waitScrimGone()
      check(!(await scrimPresent()), '快速 swipe 关闭后遮罩残留')
      // DrawerContent（modal DismissableLayer）卸载后底层立即恢复 pointer events；
      // 遮罩按自身时长独立淡出（swipe strength 注册为非继承，scrim 读不到），不阻挡交互
      check(await page.callWith(() => getComputedStyle(document.body).pointerEvents !== 'none'),
        '快速 swipe 关闭后底层 pointer events 未恢复')
    }
    // 4) swipe 取消（未达阈值）：回弹保持打开、回原位
    await openDrawer()
    await swipeDrag(-30, 160)
    await delay(350)
    const rebound = await drawerOpen()
    check(rebound && rebound.state === 'open', `回弹后抽屉应仍打开：${JSON.stringify(rebound)}`)
    check(rebound && rebound.x > -10, `回弹应回原位：${JSON.stringify(rebound)}`)
    check(rebound && !rebound.dismissed, `回弹不应带 dismissed 标记：${JSON.stringify(rebound)}`)
    await escapeKey()
    await waitClosed('rebound close unmount')

    // 5) 关闭动画中重新打开：位移变量归零、无 dismissed 残留、贴原位
    await openDrawer()
    await escapeKey()
    await delay(60)
    await page.tapSelector('[data-testid=nav-menu]')
    await page.waitForValue('!!document.querySelector("[data-testid=nav-drawer-panel]")', Boolean, { label: 'reopen during exit' })
    await delay(400)
    const reopened = await drawerOpen()
    check(reopened && reopened.x > -10, `退出中重开应贴原位：${JSON.stringify(reopened)}`)
    check(reopened && !reopened.dismissed, `退出中重开不应带 dismissed：${JSON.stringify(reopened)}`)
    check(reopened && ['0px', ''].includes(reopened.swipeX), `退出中重开位移变量应归零：${JSON.stringify(reopened)}`)
    await escapeKey()
    await waitClosed('reopen close unmount')

    // 6) reduced-motion：无空间退场动画 → 卸载即时、遮罩无残留、可重开
    if (scenario.reducedMotion) {
      await openDrawer()
      const reducedMs = await escapeAndMeasure()
      check(reducedMs > 0 && reducedMs < 120, `reduced-motion 应立即卸载：${reducedMs}ms`)
      check(!(await scrimPresent()), 'reduced-motion 关闭后遮罩残留')
      await openDrawer()
      await escapeKey()
      await waitClosed('reduced-motion final close')
    }
  } catch (error) {
    failures.push(error.message, ...await page.diagnose())
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId }).catch(() => {})
  }
  return { name: scenario.name, failures: [...failures, ...page.consoleErrors], viewport: `${scenario.width}x${scenario.height}` }
}
