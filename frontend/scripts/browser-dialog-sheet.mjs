import { Page } from './browser-page.mjs'
import { measurePaintOrder, measureReachability } from './browser-occlusion.mjs'

export const DIALOG_SHEET_SCENARIOS = [...['showcase', 'classic'].flatMap(profile => [
  { width: 390, height: 844, touch: true },
  { width: 740, height: 360, touch: true },
  { width: 1024, height: 768, touch: true },
  { width: 1440, height: 900, touch: false },
].map(size => ({ ...size, profile, name: `dialog-sheet-${profile}-${size.width}x${size.height}` }))),
{ width: 740, height: 360, touch: true, profile: 'showcase', name: 'dialog-sheet-showcase-740x360-safe-area',
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
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`)
    const reach = await measureReachability(page, { options: [selector], touch: scenario.touch !== false })
    check(reach.sampled > 0, `可达性断言空跑：${selector}`)
    failures.push(...reach.failures)
    if (reach.failures.length) throw new Error(`控件不可达：${selector}`)
    if (scenario.safeAreaInsets) {
      const safe = await page.evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(), inset=${JSON.stringify(scenario.safeAreaInsets)};
        return r.left >= inset.left && r.right <= innerWidth-inset.right && r.top >= inset.top && r.bottom <= innerHeight-inset.bottom })()`)
      check(safe, `控件侵入安全区：${selector}`)
    }
    const point = await page.evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:${rightEdge ? 'r.right-2' : 'r.left+r.width/2'},y:r.top+r.height/2} })()`)
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
