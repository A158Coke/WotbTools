import assert from 'node:assert/strict'
import { Page } from './browser-page.mjs'
import { measureReachability, measureTouchTargets } from './browser-occlusion.mjs'

export const CATALOG_HOF_DOC_SCENARIOS = ['showcase', 'classic'].flatMap(profile => [
  { width: 390, height: 844 }, { width: 740, height: 360 },
].flatMap(size => ['catalog', 'hof', 'docs', 'dialog'].map(mode => ({
  ...size, profile, mode, touch: true, name: `overlay-${mode}-${profile}-${size.width}x${size.height}`,
})))).concat(['showcase', 'classic'].map(profile => ({
  width: 1440, height: 900, touch: false, profile, mode: 'docs', name: `overlay-docs-${profile}-1440x900`,
})))

/** 真实组件/DOM/CSS 与原始输入；仅外部 HTTP 榜单及静态图片使用确定性夹具。 */
export async function runCatalogHofDocScenario(env, scenario) {
  const { sessionId, targetId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  const failures = []
  const requests = []
  const cdp = (method, args) => env.chrome.client.send(method, args, sessionId)
  async function tap(selector) {
    await page.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`, Boolean)
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`)
    await page.animationsSettled()
    const reach = await measureReachability(page, { options: [selector], touch: scenario.touch !== false })
    assert.ok(reach.sampled > 0, `${selector}: 可达性检测不得空跑`)
    assert.deepEqual(reach.failures, [], `${selector}: ${reach.failures.join('; ')}`)
    const point = await page.evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
    await page.tap({ ...point, touch: scenario.touch !== false })
  }
  async function reachableControls(selector) {
    const count = await page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
    assert.ok(count > 0, '筛选控件不得为空')
    for (let i = 0; i < count; i++) {
      await page.evaluate(`(() => { const e=document.querySelectorAll(${JSON.stringify(selector)})[${i}]; e.dataset.occlusionControl='current'; e.scrollIntoView({block:'center',inline:'nearest'}) })()`)
      const result = await measureReachability(page, { options: ['[data-occlusion-control=current]'], touch: scenario.touch !== false })
      assert.ok(result.sampled > 0)
      assert.deepEqual(result.failures, [], result.failures.join('; '))
      await page.evaluate('delete document.querySelector("[data-occlusion-control=current]").dataset.occlusionControl')
    }
  }
  try {
    await page.enable()
    await page.emulate(scenario)
    env.chrome.client.on('Fetch.requestPaused', async (event, session) => {
      if (session !== sessionId) return
      const url = new URL(event.request.url)
      let body
      if (url.pathname === '/api/hof/vehicle-options') body = [
        { tankId: 9001, tankName: '测试重坦', nation: 'GERMANY', type: 'HEAVY_TANK', tier: 10 },
        { tankId: 9002, tankName: '测试中坦', nation: 'USA', type: 'MEDIUM_TANK', tier: 9 },
      ]
      else if (url.pathname.startsWith('/api/hof')) {
        requests.push(url.pathname + url.search)
        body = { items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 }
        if (url.pathname !== '/api/hof') Object.assign(body, { vehicleId: null, vehicleName: '' })
      } else if (url.pathname.endsWith('/crops.json')) body = { icons: {} }
      if (body !== undefined) await cdp('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') })
      else if (url.pathname.endsWith('.webp')) await cdp('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=' })
      else await cdp('Fetch.continueRequest', { requestId: event.requestId })
    })
    await cdp('Fetch.enable', { patterns: [{ urlPattern: `${env.origin}/api/hof*` }, { urlPattern: `${env.origin}/catalog-assets/*` }] })
    await page.goto(`${env.origin}/scripts/browser-fixtures/catalog-hof-docs.html?mode=${scenario.mode}&profile=${scenario.profile}&assets=${encodeURIComponent(`${env.origin}/catalog-assets`)}`)
    await page.waitForValue('!!document.querySelector("[data-testid=catalog-hof-docs-fixture]")', Boolean)

    if (scenario.mode === 'dialog') {
      // 选择器在 dialog 上下文内展开：列表不得被 dialog 的内容裁掉，选项要真实可点。
      await tap('#dialog-vehicle')
      await page.waitForValue('!!document.querySelector(".vp-option")', Boolean)
      await reachableControls('.vp-option')
      await tap('.vp-option:last-child')
      await page.waitForValue('document.querySelector("#dialog-vehicle").getAttribute("aria-expanded")', value => value === 'false')
    } else if (scenario.mode === 'catalog') {
      await tap('[data-testid=filter-toggle]')
      await page.waitForValue('!!document.querySelector(".sheet [data-testid=tank-filters]")', Boolean)
      await reachableControls('.sheet select, .sheet [data-testid=filter-sheet-done]')
      await tap('[data-testid=filter-tier]')
      for (const [key, code] of [['ArrowDown', 40], ['Enter', 13]]) {
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code })
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
      }
      await page.waitForValue('document.querySelector("[data-testid=filter-tier]").value', value => value === '9')
      await tap('[data-testid=filter-sheet-done]')
      await page.waitForValue('!document.querySelector(".sheet")', Boolean)
      await tap('[data-testid=filter-chip][data-key=tier]')
      await page.waitForValue('!document.querySelector("[data-testid=filter-chip][data-key=tier]")', Boolean)
      await tap('[data-tank-id="9002"]')
      await page.waitForValue('document.querySelector("[data-testid=catalog-selected]").textContent', value => value === '9002')
    } else if (scenario.mode === 'hof') {
      for (const [tab, nth] of [['single', 1], ['hundred', 2], ['mark3', 3]]) {
        if (nth > 1) await tap(`[data-tour=hof-tabs] button:nth-child(${nth})`)
        await tap(`[data-hof-pane=${tab}] [data-testid=filter-toggle]`)
        await page.waitForValue('!!document.querySelector(".sheet .lb-toolbar-host")', Boolean)
        await page.animationsSettled()
        await reachableControls('.sheet select:not(:disabled), .sheet input:not(:disabled), .sheet button:not(:disabled)')
        await page.waitForValue('!!document.querySelector(".sheet [role=combobox]:not(:disabled)")', Boolean)
        await tap('.sheet [role=combobox]')
        await page.waitForValue('document.querySelector(".sheet [role=combobox]").getAttribute("aria-expanded")', value => value === 'true')
        await tap('.sheet .vp-option:nth-child(2)')
        await page.waitForValue('document.querySelector(".sheet [role=combobox]").dataset.value', Boolean)
        await page.waitForValue('document.querySelector(".sheet [role=combobox]").getAttribute("aria-expanded")', value => value === 'false')
        await tap('.sheet [data-testid=filter-done]')
        await page.waitForValue('!document.querySelector(".sheet")', Boolean)
        await tap(`[data-hof-pane=${tab}] [data-testid=filter-chip][data-key=vehicle]`)
        await page.waitForValue(`!document.querySelector('[data-hof-pane=${tab}] [data-testid=filter-chip][data-key=vehicle]')`, Boolean)
      }
      assert.ok(requests.some(path => path.startsWith('/api/hof?')), '单场列表真实 transport 必须执行')
      assert.ok(requests.some(path => path.startsWith('/api/hof/hundred?')), '百场列表真实 transport 必须执行')
      assert.ok(requests.some(path => path.startsWith('/api/hof/mark3?')), '三环列表真实 transport 必须执行')
      assert.equal(await page.evaluate('document.querySelector(".lb-wrap .error")?.textContent.trim() || ""'), '', '榜单及车辆选项不能停在错误态')
    } else {
      const compact = scenario.width < 1200
      const toc = compact ? '[data-testid=doc-toc-compact]' : '[data-testid=doc-toc]'
      if (compact) {
        await tap(`${toc} summary`)
        await page.waitForValue('document.querySelector("[data-testid=doc-toc-compact]").open', Boolean)
      }
      await reachableControls(`${toc} a`)
      await tap(`${toc} a[href="#section-18"]`)
      await page.waitForValue('location.hash === "#section-18"', Boolean)
      if (compact) assert.equal(await page.evaluate('document.querySelector("[data-testid=doc-toc-compact]").open'), false)
      else {
        const box = await page.evaluate('(() => {const el=document.querySelector("[data-testid=doc-toc]"), r=el.getBoundingClientRect();return {position:getComputedStyle(el).position,top:r.top,bottom:r.bottom,height:innerHeight}})()')
        assert.equal(box.position, 'sticky')
        assert.ok(box.top >= 0 && box.bottom <= box.height + 1, '桌面吸顶目录保持在可用视口内')
      }
      await page.waitForValue('!!document.querySelector("[data-testid=doc-back-to-top]")', Boolean)
      await tap('[data-testid=doc-back-to-top]')
      await page.waitForValue('window.scrollY < 2', Boolean)
    }
    assert.ok(await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), '页面不得产生横向溢出')
    if (scenario.touch !== false) {
      const touch = await measureTouchTargets(page)
      assert.ok(touch.scanned > 0, '触控扫描不得空跑')
      assert.deepEqual(touch.failures, [])
    }
  } catch (error) {
    failures.push(error.message, ...await page.diagnose(() => [...document.querySelectorAll('.sheet, .sheet-body, .lb-toolbar-host, .lb-sheet-head, [data-testid=filter-done]')].map(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el)
      return { name: el.className, x:r.x, y:r.y, w:r.width, h:r.height, clientWidth:el.clientWidth, scrollWidth:el.scrollWidth, overflow:s.overflow, position:s.position, transform:s.transform }
    })))
  } finally {
    failures.push(...page.consoleErrors)
    await cdp('Fetch.disable').catch(() => {})
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return { name: scenario.name, viewport: `${scenario.width}x${scenario.height}`, failures }
}
