import { measureReachability } from './browser-occlusion.mjs'

export function createOnboardingScenarios({ Page, setLastPage, results, check, clickCenterExpression, captureMobileReview, startFixtureServer }) {
const ONBOARDING_SCENARIOS = [...['zh', 'en', 'ru'].flatMap(language => ['summer', 'winter'].flatMap(profile =>
  [{ width: 1600, height: 1000, touch: false }, { width: 1024, height: 900, touch: false }, { width: 390, height: 844, touch: true }]
    .map(viewport => ({ ...viewport, language, profile, name: `onboarding-${language}-${profile}-${viewport.width}` })))),
  { name: 'onboarding-fullscreen-844', width: 844, height: 390, touch: true, language: 'zh', profile: 'summer', fullscreen: true },
  { name: 'onboarding-narrow-desktop-840', width: 840, height: 900, touch: false, language: 'zh', profile: 'summer' },
  { name: 'onboarding-fullscreen-transition-844', width: 844, height: 390, touch: true, language: 'zh', profile: 'summer', fullscreen: true, fullscreenTransition: true }]
let onboardingServer = null
async function runOnboardingScenario(env, scenario) {
  if (!onboardingServer) onboardingServer = await startFixtureServer({ realReplay: true })
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  const failures = []
  try {
    await page.enable()
    await page.emulate(scenario)
    await env.chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source:
      `localStorage.setItem('wotb-lang', ${JSON.stringify(scenario.language)}); localStorage.setItem('wotb-ui-profile', ${JSON.stringify(scenario.profile)});` }, sessionId)
    const url = `${onboardingServer.origin}/?view=home&ws-auth=0&ws-onboarding=${scenario.name}`
    await page.goto(url)
    await page.installInputTrace()
    const hit = async selector => {
      const center = await page.waitForValue(clickCenterExpression(selector), value => value != null,
        { label: `guide hit target ${selector}` })
      await page.tap({ ...center, touch: scenario.touch })
    }
    await page.waitFor(() => !!document.querySelector('[data-testid="home-onboarding"]'), { label: 'anonymous homepage tutorial button' })
    check(failures, await page.evaluate('!document.querySelector("[data-testid=onboarding-welcome]")'), 'anonymous visit must not auto-open tutorial')
    await hit('[data-testid="home-onboarding"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="onboarding-directory"]'), { label: 'homepage opens the complete feature directory' })
    await hit('[data-testid="onboarding-restart"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="onboarding-welcome"]'), { label: 'explicit tutorial request' })
    await hit('[data-testid="onboarding-begin"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="workspace-demo-label"]') && !!document.querySelector('[data-tour="data-toolbar"]'),
      { timeout: 60000, label: 'real sample locally analyzed' })
    check(failures, await page.evaluate('!!document.querySelector("[data-tour=workspace-help]")'), 'anonymous replay workspace keeps the feature guide entry')
    const anchors = ['workspace-demo', 'data-toolbar', 'playback-transport', 'playback-annotation-entry', 'playback-declutter']
    let skippedInFullscreen = false
    for (let node = 0; node < anchors.length; node++) {
      const anchor = anchors[node]
      await page.waitForValue('document.querySelector("[data-testid=onboarding-card]")?.dataset.step',
        value => Number(value) === node + 1, { label: `guide node ${node + 1}` })
      await page.waitForValue(`(() => {
        const card = document.querySelector('[data-testid="onboarding-card"]');
        const target = [...document.querySelectorAll('[data-tour=${JSON.stringify(anchor)}]')].find(el => el.getBoundingClientRect().width > 0);
        return card && target && !!document.querySelector('[data-testid="onboarding-cutout"]');
      })()`, value => value === true, { label: `real anchored guide ${node + 1}` })
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const geometry = await page.evaluate(`(() => {
        const card=document.querySelector('[data-testid="onboarding-card"]').getBoundingClientRect();
        const navigation=document.querySelector('.onboarding-card-actions').getBoundingClientRect();
        const target=[...document.querySelectorAll('[data-tour=${JSON.stringify(anchor)}]')].find(el=>el.getBoundingClientRect().width>0).getBoundingClientRect();
        return { overflow:document.documentElement.scrollWidth>innerWidth+1,
          cardOut:card.left<0||card.right>innerWidth+1||card.top<0||card.bottom>innerHeight+1,
          covered:Math.min(card.right,target.right)>Math.max(card.left,target.left)&&Math.min(card.bottom,target.bottom)>Math.max(card.top,target.top),
          navigationCovered:Math.min(navigation.right,target.right)>Math.max(navigation.left,target.left)&&Math.min(navigation.bottom,target.bottom)>Math.max(navigation.top,target.top),
          navigationOut:navigation.left<0||navigation.right>innerWidth+1||navigation.top<0||navigation.bottom>innerHeight+1 };
      })()`)
      check(failures, !geometry.overflow && !geometry.cardOut && !geometry.covered && !geometry.navigationCovered && !geometry.navigationOut,
        `node ${node + 1} target/card geometry: ${JSON.stringify(geometry)}`)
      if (node === 2) {
        if (scenario.fullscreen) {
          check(failures, await page.evaluate('!!document.fullscreenEnabled'),
            'document.fullscreenEnabled must be true before the fullscreen tap')
          await hit('[data-test="pb-fullscreen"]')
          await page.waitFor(() => !!document.fullscreenElement, { label: 'actual 2D fullscreen' })
          const fullscreenGeometry = await page.evaluate(`(() => {
            const target=document.querySelector('[data-tour="playback-transport"]').getBoundingClientRect();
            const navigation=document.querySelector('.onboarding-card-actions').getBoundingClientRect();
            return {target:{left:target.left,top:target.top,right:target.right,bottom:target.bottom},navigation:{left:navigation.left,top:navigation.top,right:navigation.right,bottom:navigation.bottom},
              covered:Math.min(navigation.right,target.right)>Math.max(navigation.left,target.left)&&Math.min(navigation.bottom,target.bottom)>Math.max(navigation.top,target.top),
              hostOwned:document.fullscreenElement.contains(document.querySelector('[data-testid="onboarding-host"]'))};
          })()`)
          if (fullscreenGeometry.covered || !fullscreenGeometry.hostOwned) throw new Error(`fullscreen guide geometry ${JSON.stringify(fullscreenGeometry)}`)
        }
        await hit('[data-test="pb-play"]')
        check(failures, await page.evaluate('window.__wsInput.click?.test') === 'pb-play', 'guide must admit the actual play button')
        await hit('[data-test="pb-play"]')
        if (scenario.fullscreen && !scenario.fullscreenTransition) {
          await hit('[data-testid="onboarding-skip"]')
          check(failures, await page.evaluate('!document.querySelector("[data-testid=onboarding-layer]")'), 'skip inside actual fullscreen removes teaching overlay')
          await hit('[data-test="pb-fullscreen"]')
          await page.waitFor(() => !document.fullscreenElement, { label: 'actual 2D fullscreen exit' })
          skippedInFullscreen = true
          break
        }
      }
      if (node === 3) {
        await hit(`[data-tour="${anchor}"]`)
        await page.waitFor(() => !!document.querySelector('[data-tour="playback-annotation-tools"]'), { label: 'real annotation toolbar' })
        check(failures, await page.evaluate('!!document.querySelector("[data-test=pb-annot-arrow]")'), 'drawing tools available during guide')
      }
      if (node === 4) {
        await hit(`[data-tour="${anchor}"]`)
        check(failures, await page.evaluate('document.querySelector("[data-tour=playback-declutter]").getAttribute("aria-pressed") === "true"'),
          'real declutter preference changed through guide cutout')
      }
      await hit('[data-testid="onboarding-next"]')
      check(failures, await page.evaluate('window.__wsInput.click?.testId') === 'onboarding-next',
        `node ${node + 1} Next click must reach the teaching card`)
    }
    if (!skippedInFullscreen) {
      await page.waitForValue('new URLSearchParams(location.search).get("view")', value => value === 'agent-replay', { label: '3D guide destination' })
      if (scenario.fullscreenTransition) {
        await page.waitFor(() => !!document.querySelector('[data-tour="replay3d-start"]'), { label: 'real 3D start controls mounted' })
        const handoff = await page.evaluate(`(() => {
          const start=document.querySelector('[data-tour="replay3d-start"]'),root=document.fullscreenElement;
          return {fullscreen:!!root,fullscreenOwner:root?.dataset.tour,
            startInsideOwner:!root||root.contains(start),startWidth:start.getBoundingClientRect().width,
            guideWidth:document.querySelector('[data-testid="onboarding-card"]')?.getBoundingClientRect().width};
        })()`)
        if (!handoff.startInsideOwner || !handoff.startWidth || !handoff.guideWidth) throw new Error(`fullscreen capability handoff trapped the guide ${JSON.stringify(handoff)}`)
        const startPoint = await page.evaluate(`(() => {
          const button = document.querySelector('[data-test="replay3d-start"]')
          const r = button.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
          return { x, y, onButton: button.contains(document.elementFromPoint(x, y)) }
        })()`)
        check(failures, startPoint.onButton, `3D start must be reachable beside the guide card: ${JSON.stringify(startPoint)}`)
        await page.tap({ ...startPoint, touch: scenario.touch })
        await page.waitForValue('document.querySelector("[data-testid=onboarding-card]")?.dataset.anchor', value => value === 'replay3d-camera',
          { timeout: 60_000, label: 'guide auto-advances to the camera stage' })
        await page.waitFor(() => !!document.querySelector('.pb-root.compact-bar [data-testid="display-panel"] [data-tour="replay3d-camera"]'),
          { label: 'compact guide opens Display and the camera anchor exists' })
      }
      await hit('[data-testid="onboarding-next"]')
      await page.waitForValue('new URLSearchParams(location.search).get("view")', value => value === 'agent-shots', { label: 'shots guide destination' })
      await page.waitFor(() => !!document.querySelector('[data-tour="shots-first-shot"]') && !document.querySelector('.onboarding-status'),
        { timeout: 60_000, label: 'actual sample shooting lesson prepared' })
      check(failures, await page.evaluate('document.querySelector("[data-testid=shots-shooter-select]")?.value') === 'own', 'shooting lesson resets the recorder filter')
      await hit('[data-tour="shots-first-shot"]')
      await page.waitFor(() => !!document.querySelector('[data-testid="shot-inspector"]'), { label: 'actual sample shot inspector' })
      await page.waitForValue('document.querySelector("[data-testid=onboarding-card]")?.dataset.anchor', value => value === 'shot-open-viewer', { label: 'core shooting details action' })
      await page.waitForValue(`(() => {
        const panel=document.querySelector('[data-testid="shot-inspector"]')?.getBoundingClientRect();
        const card=document.querySelector('[data-testid="onboarding-card"]')?.getBoundingClientRect();
        const nav=document.querySelector('.onboarding-card-actions')?.getBoundingClientRect();
        const overlaps=(a,b)=>a&&b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
        return panel&&card&&nav&&!overlaps(panel,card)&&!overlaps(panel,nav);
      })()`, value => value === true, { label: 'core guide card and navigation do not cover the shot inspector' })
      await captureMobileReview(page, scenario, 'onboarding-shot-details')
      await hit('[data-testid="shot-detail-close"]')
      await page.waitForValue('document.querySelector("[data-testid=onboarding-card]")?.dataset.anchor', value => value === 'shots-first-shot', { label: 'closing actual inspector returns to the shot list' })
      await hit('[data-testid="onboarding-skip"]')
      check(failures, await page.evaluate('!document.querySelector("[data-testid=onboarding-layer]")'),
        `skip must remove overlay: ${JSON.stringify(await page.evaluate('({click:window.__wsInput.click,primary:window.__wsInput.primary,pointers:window.__wsInput.pointers.slice(-3)})'))}`)
    }
    await page.goto(url)
    await page.waitFor(() => !!document.querySelector('[data-testid="home-onboarding"]'), { label: 'homepage after reload' })
    await page.installInputTrace()
    check(failures, await page.evaluate('!document.querySelector("[data-testid=onboarding-welcome]")'), 'same-epoch skip must suppress fresh invitation')
    await hit('[data-testid="home-onboarding"]')
    await hit('[data-testid="onboarding-restart"]')
    await hit('[data-testid="onboarding-begin"]')
    for (let node = 1; node <= 7; node++) {
      await page.waitForValue('document.querySelector("[data-testid=onboarding-card]")?.dataset.step', value => Number(value) === node,
        { label: `manual restart node ${node}` })
      await hit('[data-testid="onboarding-next"]')
    }
    await page.waitFor(() => !!document.querySelector('[data-testid="onboarding-finish"]'), { label: 'manual tutorial completion' })
    await captureMobileReview(page, scenario, 'onboarding-complete')
    check(failures, await page.evaluate('document.querySelectorAll("[data-testid=onboarding-follow-ups] .onboarding-topic").length') === 5, 'core completion directly exposes five optional guides')
    await hit('[data-testid="onboarding-follow-up-ai"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="onboarding-ai-login"]') && !document.querySelector('[data-testid="onboarding-begin"]'), { label: 'anonymous AI tutorial requires login before preparation' })
    await hit('[data-testid="onboarding-skip-welcome"]')
    await page.goto(url)
    await page.waitFor(() => !!document.querySelector('[data-testid="home-onboarding"]'), { label: 'homepage feature directory after completion' })
    await hit('[data-testid="home-onboarding"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="onboarding-directory"]'), { label: 'manual guide directory' })
    check(failures, await page.evaluate('document.querySelectorAll(".onboarding-topic").length') === 10, 'directory covers ten public topics')
  } catch (error) {
    const detail = await page.evaluate(`({step:document.querySelector('[data-testid="onboarding-card"]')?.dataset.step,
      title:document.querySelector('#onboarding-step-title')?.textContent,click:window.__wsInput?.click,
      primary:window.__wsInput?.primary,pointers:window.__wsInput?.pointers?.slice(-6),route:location.search,
      dialogs:[...document.querySelectorAll('[role="dialog"]')].map(el=>({test:el.dataset.testid,text:el.textContent?.slice(0,300),visible:el.getBoundingClientRect().height>0})),
      receipt:localStorage.getItem('wotbtools-onboarding'),source:document.querySelector('.workspace-source')?.textContent?.slice(0,300),
      shotClose:(()=>{const el=document.querySelector('[data-testid=shot-detail-close]');if(!el)return null;const r=el.getBoundingClientRect();return {rect:r.toJSON(),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,300),scrollY,innerHeight};})()})`).catch(() => null)
    throw new Error(`${error.message}; ${JSON.stringify(detail)}; ${page.consoleErrors.join(' | ')}`)
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  results.push({ name: scenario.name, failures: [...failures, ...page.consoleErrors], viewport: `${scenario.width}x${scenario.height}` })
}

const MENU_VIEWPORT_SCENARIOS = ['summer', 'winter'].flatMap(profile => [
  { width: 360, height: 640, touch: true },
  { width: 740, height: 360, touch: true },
  { width: 740, height: 240, touch: true },
  { width: 1024, height: 768, touch: true },
  { width: 1440, height: 900, touch: false },
].map(size => ({ ...size, profile, name: `menu-viewport-${profile}-${size.width}x${size.height}` })))

async function runMenuViewportScenario(env, scenario) {
  const { sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  const failures = []
  await page.enable()
  await page.emulate(scenario)
  await page.goto(`${env.origin}/scripts/browser-fixtures/menu-button.html?profile=${scenario.profile}`)
  await page.waitForValue('!!document.querySelector("[data-testid=menu-trigger]")', Boolean)

  async function tap(selector) {
    const point = await page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.tap({ ...point, touch: scenario.touch })
  }
  async function open() {
    await tap('[data-testid=menu-trigger]')
    await page.waitForValue('!!document.querySelector("[role=menu]")', Boolean)
    await page.waitForValue('document.getAnimations().every(a => a.playState !== "running")', Boolean,
      { timeout: 3000, label: 'menu entry animation settled' })
  }
  async function checkBounds() {
    const box = await page.evaluate(`(() => {
      const el = document.querySelector('[role=menu]'), r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height,
        viewportWidth: innerWidth, viewportHeight: innerHeight, client: el.clientHeight, scroll: el.scrollHeight }
    })()`)
    check(failures, box.top >= -1 && box.bottom <= box.viewportHeight + 1,
      `menu leaves vertical viewport: ${JSON.stringify(box)}`)
    check(failures, box.left >= -1 && box.right <= box.viewportWidth + 1,
      `menu leaves horizontal viewport: ${JSON.stringify(box)}`)
    if (box.viewportHeight === 240) check(failures, box.scroll > box.client, 'short viewport must scroll inside the menu')
  }
  async function key(name, code) {
    await env.chrome.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code }, sessionId)
    await env.chrome.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code }, sessionId)
  }

  await open()
  await checkBounds()
  if (failures.length) throw new Error(failures.join('\n'))
  for (const [name, code, item] of [['End', 35, 'png'], ['Home', 36, 'aggregate']]) {
    await key(name, code)
    await page.waitForValue(`document.activeElement?.dataset.testid`, value => value === `menu-${item}`)
    const reach = await measureReachability(page, { options: [`[data-testid=menu-${item}]`], touch: scenario.touch })
    check(failures, reach.sampled > 0, `${name}: reachability probe must sample an item`)
    failures.push(...reach.failures)
  }
  await key('Escape', 27)
  await page.waitForValue('!document.querySelector("[role=menu]")', Boolean)
  await page.waitForValue('document.activeElement?.dataset.testid', value => value === 'menu-trigger')

  for (const item of ['aggregate', 'each', 'png']) {
    await open()
    await page.evaluate(`document.querySelector('[data-testid=menu-${item}]').scrollIntoView({block:'nearest'})`)
    const reach = await measureReachability(page, { options: [`[data-testid=menu-${item}]`], touch: scenario.touch })
    check(failures, reach.sampled > 0, `${item}: reachability probe must sample an item`)
    failures.push(...reach.failures)
    await tap(`[data-testid=menu-${item}]`)
    await page.waitForValue('document.querySelector("[data-testid=menu-selected]")?.textContent', value => value === item)
    await page.waitForValue('!document.querySelector("[role=menu]")', Boolean)
  }
  if (scenario.height > 240) {
    await open()
    for (const height of [240, scenario.height]) {
      await page.emulate({ ...scenario, height })
      await page.waitForValue(`(() => {
        const r = document.querySelector('[role=menu]').getBoundingClientRect()
        return innerHeight === ${height} && r.top >= -1 && r.bottom <= innerHeight + 1
      })()`, Boolean, { timeout: 3000, label: `menu within resized ${height}px viewport` })
      await checkBounds()
    }
    await key('Escape', 27)
    await page.waitForValue('!document.querySelector("[role=menu]")', Boolean)
  }
  results.push({ name: scenario.name, failures: [...failures, ...page.consoleErrors], viewport: `${scenario.width}x${scenario.height}` })
}


return { ONBOARDING_SCENARIOS, MENU_VIEWPORT_SCENARIOS, runOnboardingScenario, runMenuViewportScenario, closeOnboardingServer: async () => { if (onboardingServer) await onboardingServer.server.close() } }
}
