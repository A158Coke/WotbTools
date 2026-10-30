import { Page } from './browser-page.mjs'
import { measureReachability, measureTouchTargets } from './browser-occlusion.mjs'

export const DRAWER_TABLE_SCENARIOS = ['showcase', 'classic'].flatMap(profile => [
  { width: 390, height: 844, touch: true },
  { width: 740, height: 360, touch: true },
  { width: 1024, height: 768, touch: true },
  { width: 1440, height: 900, touch: false },
].map(size => ({ ...size, profile, name: `drawer-tables-${profile}-${size.width}x${size.height}` })))

export async function runDrawerTableScenario(env, scenario) {
  const { sessionId, targetId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  const failures = []
  const check = (value, message) => { if (!value) failures.push(message) }
  const q = selector => JSON.stringify(selector)
  async function reveal(selector) {
    await page.evaluate(`document.querySelector(${q(selector)}).scrollIntoView({block:'center',inline:'nearest'})`)
    await page.animationsSettled()
  }
  async function reach(selector, interactive = true) {
    await reveal(selector)
    const result = await measureReachability(page, { options: [selector], touch: interactive && scenario.touch })
    check(result.sampled > 0, `${selector}: reachability probe must not be empty`)
    failures.push(...result.failures)
  }
  async function tap(selector) {
    await reveal(selector)
    const point = await page.evaluate(`(() => { const r=document.querySelector(${q(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
    await page.tap({ ...point, touch: scenario.touch })
  }
  try {
    await page.enable()
    await page.emulate(scenario)
    await page.goto(`${env.origin}/scripts/browser-fixtures/drawer-tables.html?profile=${scenario.profile}`)
    await page.waitForValue('document.querySelectorAll(".cw-table tbody tr").length', n => n === 2)

    // 三种真实表格在横向滚动后仍能访问末列，不依赖页面横向溢出。
    for (const id of ['cw-fixture','battle-fixture','aggregate-fixture']) {
      const container = `[data-testid=${id}] .tablewrap`
      await page.waitForValue(`!!document.querySelector(${q(container)})`, Boolean)
      await page.evaluate(`(()=>{const el=document.querySelector(${q(container)});el.scrollLeft=el.scrollWidth})()`)
      await reach(`[data-testid=${id}] tbody tr:first-child td:last-child`, false)
    }
    check(await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'tables must not overflow the document horizontally')

    // sticky 昵称列在横向滚动后仍可真实选中，打开生产玩家详情。
    await tap('[data-testid=cw-fixture] tbody tr:first-child td:first-child')
    await page.waitForValue('!!document.querySelector("[data-testid=player-drawer]")', Boolean)
    await page.animationsSettled()
    const layout = await page.evaluate(`(() => {
      const panel=document.querySelector('[data-testid=player-drawer]'), r=panel.getBoundingClientRect()
      const table=document.querySelector('[data-testid=cw-fixture] .tablewrap').getBoundingClientRect()
      const x=Math.max(1,Math.min(innerWidth-1,table.left+table.width/2))
      const y=Math.max(1,Math.min(innerHeight-1,table.top+table.height/2))
      return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:innerWidth, height:innerHeight,
        tableRight:table.right, modal:panel.getAttribute('aria-modal'), coversTable:panel.contains(document.elementFromPoint(x,y)) }
    })()`)
    check(layout.left >= -1 && layout.right <= layout.width + 1 && layout.top >= -1 && layout.bottom <= layout.height + 1,
      `drawer must stay in viewport: ${JSON.stringify(layout)}`)
    if (scenario.width < 768) check(layout.modal === 'true' && layout.coversTable, 'mobile modal must paint above the table')
    else check(layout.tableRight <= layout.left + 1, `non-modal drawer must leave table space: ${JSON.stringify(layout)}`)
    if (scenario.width >= 1200) {
      const before = await page.evaluate(`(() => {
        const r=document.querySelector('[data-testid=drawer-resizer]').getBoundingClientRect()
        const panel=document.querySelector('[data-testid=player-drawer]').getBoundingClientRect()
        return { x:r.left+r.width/2, y:r.top+r.height/2, panelLeft:panel.left, width:panel.width }
      })()`)
      check(Math.abs(before.x - before.panelLeft) <= 1, 'resizer must align to drawer edge with the document scrollbar present')
      await env.chrome.client.send('Input.dispatchMouseEvent', { type:'mousePressed', x:before.x, y:before.y, button:'left', clickCount:1 }, sessionId)
      await env.chrome.client.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:before.x-40, y:before.y, button:'left', buttons:1 }, sessionId)
      await env.chrome.client.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:before.x-40, y:before.y, button:'left', clickCount:1 }, sessionId)
      await page.waitForValue('document.querySelector("[data-testid=player-drawer]").getBoundingClientRect().width', value => Math.abs(value-before.width-40) <= 1,
        { label:'real pointer drag grows the drawer by 40px' })
    }
    await reach('.pd-close')
    await reach('[data-testid=radar-settings]')
    await reach('[data-testid=export-profile]')
    await tap('[data-testid=radar-settings]')
    await page.waitForValue('!!document.querySelector("[data-testid=radar-picker]")', Boolean)
    // 雷达列表既有内层滚动容器；分别验证首末选项的 label，而非仅检查 DOM 存在。
    await reach('.radar-picker-list li:first-child .rp-item')
    await reach('.radar-picker-list li:last-child .rp-item')
    await reach('.radar-picker-list li:first-child .rp-arrow:last-child')
    const toggle = '.radar-picker-list li:first-child .rp-item'
    const before = await page.evaluate(`document.querySelector(${q(toggle + ' input')}).checked`)
    await tap(toggle)
    await page.waitForValue(`document.querySelector(${q(toggle + ' input')}).checked`, checked => checked !== before)
    await reach('.pd-close')
    await tap('.pd-close')
    await page.waitForValue('!document.querySelector("[data-testid=player-drawer]")', Boolean)

    // AI 报告表头 + 内容折叠组合，不能以截图存在代替真实操作。
    await reach('[data-test=toggle-analysis]')
    await reach('[data-test=copy-analysis-btn]')
    await tap('[data-test=toggle-analysis]')
    await page.waitForValue('document.querySelector("[data-test=toggle-analysis]").getAttribute("aria-expanded")', value => value === 'false')
    await tap('[data-test=toggle-analysis]')
    await page.waitForValue('document.querySelector("[data-test=toggle-analysis]").getAttribute("aria-expanded")', value => value === 'true')
    // 列选择器：常驻表格之上的非模态面，首末项、移动按钮都要真实可点，Esc 把焦点还给触发按钮。
    await tap('[data-testid=column-picker-open]')
    await page.waitForValue('!!document.querySelector(".colpanel")', Boolean)
    await reach('.colpanel .linkbtn:last-of-type')
    await reach('.collist li:first-child .colitem')
    await page.evaluate(`document.querySelector('.collist').scrollTop = 1e6`)
    await reach('.collist li:last-child .colitem')
    await reach('.collist li:last-child .colmove-btn:first-child')
    if (scenario.touch) {
      const touch = await measureTouchTargets(page, { root: '.colpanel' })
      check(touch.scanned > 0, 'column picker touch sweep must not be empty')
      failures.push(...touch.failures)
    }
    await page.evaluate(`document.querySelector('.colpanel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await page.waitForValue('!document.querySelector(".colpanel")', Boolean)
    check(await page.evaluate('document.activeElement?.dataset.testid === "column-picker-open"'), 'closing the column picker must restore focus to its opener')

    await reach('.prebattle-toggle')
    await tap('.prebattle-toggle')
    await page.waitForValue('document.querySelector(".prebattle-toggle").getAttribute("aria-expanded")', value => value === 'false')
    check(await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'expanded report must not overflow the document horizontally')
    if (scenario.touch) {
      const touch = await measureTouchTargets(page, { root: 'main' })
      check(touch.scanned > 0, 'page touch sweep must not be empty')
      failures.push(...touch.failures)
    }
  } catch (error) {
    failures.push(error.message, ...await page.diagnose())
  } finally {
    failures.push(...page.consoleErrors)
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return { name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` }
}
