import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { verifyMapPreviewCanvasPersistence, verifyMapPreviewTouchDrawing } from './browser-map-preview-interactions.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')

const scenarios = [
  { name: 'phone-320x568', width: 320, height: 568, touch: true, phone: true },
  { name: 'phone-360x800', width: 360, height: 800, touch: true, phone: true },
  { name: 'phone-390x844', width: 390, height: 844, touch: true, phone: true },
  { name: 'phone-430x932', width: 430, height: 932, touch: true, phone: true },
  { name: 'phone-landscape-844x390', width: 844, height: 390, touch: true, phone: true, fsTap: true },
  { name: 'desktop-1280x900', width: 1280, height: 900, touch: false, phone: false },
]

function mapPreviewGeometryProbe() {
  const q = (sel) => document.querySelector(sel)
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }
  const stage = q('[data-testid="map-2d-stage"]')
  const square = q('.map2d-square')
  const controls = q('.map2d-controls')
  const fullscreen = q('[data-testid="map-2d-fullscreen"]')
  if (!stage || !square || !controls) return { ready: false }
  const s = rect(stage)
  const sq = rect(square)
  const c = rect(controls)
  const hitTest = (el) => {
    if (!el) return null
    let r = el.getBoundingClientRect()
    if (r.bottom > window.innerHeight || r.top < 0) {
      el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit === el || el.contains(hit)
  }
  return {
    ready: true,
    isPhoneLayout: !!q('.map2d.map2d-phone'),
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    stage: s,
    square: sq,
    controls: c,
    centerXError: Math.abs((sq.left + sq.right) / 2 - (s.left + s.right) / 2),
    widthError: Math.abs(sq.width - s.width),
    aspectError: Math.abs(sq.width - sq.height),
    mapToControlsGap: c.top - sq.bottom,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    fullscreenHit: hitTest(fullscreen),
    fullscreenTopRight: fullscreen
      ? (() => {
          const root = q('.map2d')
          const fr = fullscreen.getBoundingClientRect()
          const rr = root.getBoundingClientRect()
          return { topError: Math.abs(fr.top - rr.top), rightError: Math.abs(fr.right - rr.right) }
        })()
      : null,
    toolButtons: ['map-2d-drawing-entry', 'map-2d-import', 'map-2d-export', 'map-2d-export-image']
      .map((id) => ({ id, hit: hitTest(q(`[data-testid="${id}"]`)) })),
    bodyFillContractError: q('.map2d.map2d-phone')
      ? null
      : (() => {
          const body = q('.map2d-body')
          return body ? Math.abs(rect(body).bottom - c.bottom) : null
        })(),
  }
}

async function openDrawingInFullscreen(page) {
  await delay(200)
  const entry = await page.probe(() => {
    const el = document.querySelector('[data-testid="map-2d-drawing-entry"]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const inViewport = r.top >= -1 && r.bottom <= window.innerHeight + 1
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { point: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, inViewport, clickable: el.contains(hit) }
  })
  if (!entry || !entry.inViewport || !entry.clickable) {
    throw new Error(`drawing entry not directly clickable in fullscreen: ${JSON.stringify(entry)}`)
  }
  await page.tap({ ...entry.point, touch: true })
  await page.waitForValue(
    `!!document.querySelector('[data-testid="map-2d-annotations"]')`,
    (v) => v === true,
    { label: 'fullscreen drawing toolbar open', timeout: 8000 },
  )
  await delay(400)
  return entry
}

async function openMapPreview(page, origin) {
  await page.goto(`${origin}/?view=map-preview&map=faust&mode=2d&ws-auth=1&assets=${encodeURIComponent(`${origin}/fixture-assets`)}`)
  try {
    await page.waitForValue(
      `(() => { const sq = document.querySelector('.map2d-square'); return !!sq && sq.getBoundingClientRect().width > 0 })()`,
      (v) => v === true,
      { label: 'map2d square rendered', timeout: 30_000 },
    )
  } catch (error) {
    const state = await page.probe(() => ({ href: location.href, viewport: [innerWidth, innerHeight], map: !!document.querySelector('[data-testid="map-2d-pane"]'), stage: !!document.querySelector('[data-testid="map-2d-stage"]'), square: document.querySelector('.map2d-square')?.getBoundingClientRect().toJSON(), body: document.body.innerText.slice(0, 240) }))
    throw new Error(`${error.message}; map preview navigation state=${JSON.stringify(state)}; errors=${JSON.stringify(page.consoleErrors)}`)
  }
  await page.animationsSettled()
  await delay(200)
  await page.installInputTrace()
}

async function main() {
  const chrome = findChrome()
  const chromeCdp = await launchChromeForCdp(chrome)
  const { targetId, sessionId } = await chromeCdp.openPage()
  const page = new Page(chromeCdp.client, sessionId)
  let fixture = null
  try {
    await page.enable()
    const { server, origin } = await startFixtureServer({
      middleware(req, res, next) {
        const path = req.url?.split('?')[0]
        if (path === '/fixture-assets/index.json') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ schema: 1, generated: 'fixture', maps: { 26: { key: 'faust', display: 'Faust Fixture' } } }))
          return
        }
        if (path === '/fixture-assets/cover/faust.webp') {
          res.setHeader('Content-Type', 'image/webp')
          res.end(readFileSync(resolve(frontendRoot, 'src/assets/maps/faust.webp')))
          return
        }
        next()
      },
    })
    fixture = server

    let failed = 0
    for (const scenario of scenarios) {
      await page.emulate(scenario)
      await openMapPreview(page, origin)
      const g = await page.probe(mapPreviewGeometryProbe)
      const problems = []
      if (!g.ready) problems.push('map2d not rendered')
      else {
        if (g.isPhoneLayout !== scenario.phone) problems.push(`phone layout=${g.isPhoneLayout} expected=${scenario.phone}`)
        if (g.centerXError > 2) problems.push(`square centerX error ${g.centerXError.toFixed(1)}px`)
        if (g.aspectError > 1) problems.push(`square not square (${g.square.width}x${g.square.height})`)
        if (scenario.phone && g.widthError > 1) problems.push(`square width ${g.square.width.toFixed(1)} != stage width ${g.stage.width.toFixed(1)}`)
        if (g.horizontalOverflow) problems.push('horizontal overflow')
        if (scenario.phone && g.mapToControlsGap > 2) problems.push(`map→controls gap ${g.mapToControlsGap.toFixed(1)}px`)
        if (!scenario.phone && Math.abs(g.bodyFillContractError) > 1) {
          problems.push(`desktop body-fill contract error ${g.bodyFillContractError?.toFixed(1)}px`)
        }
        if (!g.fullscreenHit) problems.push('fullscreen button not hit-testable')
        if (g.fullscreenTopRight && (Math.abs(g.fullscreenTopRight.topError - 8) > 4 || Math.abs(g.fullscreenTopRight.rightError - 8) > 4)) {
          problems.push(`fullscreen button not top-right (top ${g.fullscreenTopRight.topError.toFixed(1)}px, right ${g.fullscreenTopRight.rightError.toFixed(1)}px)`)
        }
        for (const btn of g.toolButtons) {
          if (!btn.hit) problems.push(`button ${btn.id} not hit-testable`)
        }
      }
      if (problems.length) {
        failed++
        console.error(`[FAIL] ${scenario.name}\n  ${problems.join('\n  ')}\n  geometry=${JSON.stringify(g)}`)
      } else {
        console.log(`[PASS] ${scenario.name} square=${g.square.width.toFixed(0)}x${g.square.height.toFixed(0)} gap=${g.mapToControlsGap?.toFixed(1)}`)
      }

      if (scenario.phone && g.controls.bottom <= scenario.height) {
        let entryPoint = null
        for (let i = 0; i < 20; i++) {
          await delay(250)
          const attempt = await page.probe(() => {
            const el = document.querySelector('[data-testid="map-2d-drawing-entry"]')
            if (!el) return null
            const r = el.getBoundingClientRect()
            const point = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
            const hit = document.elementFromPoint(point.x, point.y)
            return { point, ok: hit === el || el.contains(hit) }
          })
          if (attempt?.ok) { entryPoint = attempt.point; break }
        }
        if (!entryPoint) throw new Error('drawing entry missing')
        await page.tap({ ...entryPoint, touch: scenario.touch })
        try {
          await page.waitForValue(
            `!!document.querySelector('[data-testid="map-2d-annotations"]')`,
            (v) => v === true,
            { label: 'annotation toolbar open', timeout: 6000 },
          )
        } catch (error) {
          console.error('tap diagnostics:', JSON.stringify(await page.inputTrace()), 'errors:', page.consoleErrors)
          throw error
        }
        await delay(200)
        if (scenario.name === 'phone-390x844') await verifyMapPreviewTouchDrawing(page)
        const g2 = await page.probe(mapPreviewGeometryProbe)
        const problems2 = []
        if (g2.centerXError > 2) problems2.push(`centerX ${g2.centerXError.toFixed(1)}px`)
        if (g2.mapToControlsGap > 2) problems2.push(`gap ${g2.mapToControlsGap.toFixed(1)}px`)
        if (g2.horizontalOverflow) problems2.push('horizontal overflow')
        if (problems2.length) {
          failed++
          console.error(`[FAIL] ${scenario.name} (annotations open)\n  ${problems2.join('\n  ')}\n  geometry=${JSON.stringify(g2)}`)
        } else {
          console.log(`[PASS] ${scenario.name} (annotations open)`)
          const close = await page.probe(() => {
            const closeBtn = document.querySelector('[data-testid="map-2d-annotations"] [data-test="pb-annot-close"]')
            if (!closeBtn) return null
            const r = closeBtn.getBoundingClientRect()
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
          })
          if (close) {
            await page.tap({ ...close, touch: scenario.touch })
            await delay(150)
          }
        }
      }
    }

    if (scenarios.find((x) => x.fsTap)) {
      await page.emulate({ width: 844, height: 390, touch: true })
      await openMapPreview(page, origin)
      const btn = await page.probe(() => {
        const el = document.querySelector('[data-testid="map-2d-fullscreen"]')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
      if (!btn) throw new Error('fullscreen button missing for fs scenario')
      await page.tap({ ...btn, touch: true })
      await page.waitFor(() => !!document.fullscreenElement, { timeout: 8000, label: 'map preview fullscreen engage' })
      await delay(300)
      const gFs = await page.probe(mapPreviewGeometryProbe)
      const viewportH = 390
      const problemsFs = []
      if (gFs.square.bottom > viewportH + 1) problemsFs.push(`square bottom ${gFs.square.bottom.toFixed(1)} exceeds fullscreen viewport ${viewportH}`)
      if (gFs.controls.bottom > viewportH + 1 || gFs.controls.top < -1) problemsFs.push(`controls outside viewport: ${JSON.stringify(gFs.controls)}`)
      for (const b of gFs.toolButtons) {
        if (!b.hit) problemsFs.push(`fullscreen: button ${b.id} not hit-testable in viewport`)
      }
      if (gFs.horizontalOverflow) problemsFs.push('fullscreen: horizontal overflow')
      if (problemsFs.length) {
        failed++
        console.error('[FAIL] phone-landscape-fullscreen\n  ' + problemsFs.join('\n  ') + '\n  geometry=' + JSON.stringify(gFs))
      } else {
        console.log(`[PASS] phone-landscape-fullscreen square=${gFs.square.width.toFixed(0)}x${gFs.square.height.toFixed(0)} controlsBottom=${gFs.controls.bottom.toFixed(0)}`)
      }
      const gOpen = await openDrawingInFullscreen(page)
      const gDraw = await page.probe(mapPreviewGeometryProbe)
      const problemsDraw = []
      if (gDraw.controls.bottom > 390 + 1) problemsDraw.push(`drawing: controls bottom ${gDraw.controls.bottom.toFixed(1)} exceeds viewport`)
      if (Math.abs(gDraw.square.width - gDraw.square.height) > 1) problemsDraw.push(`drawing: square not square ${gDraw.square.width}x${gDraw.square.height}`)
      for (const b of gDraw.toolButtons) {
        if (b.hit === false) problemsDraw.push(`drawing: ${b.id} not hit-testable`)
      }
      if (gFs.square.height > 0 && gDraw.square.height >= gFs.square.height && gDraw.controls.height > gFs.controls.height + 4) {
        problemsDraw.push(`drawing: map did not shrink for taller toolbar (square ${gDraw.square.height.toFixed(0)} vs ${gFs.square.height.toFixed(0)}, controls ${gDraw.controls.height.toFixed(0)} vs ${gFs.controls.height.toFixed(0)})`)
      }
      if (problemsDraw.length) {
        failed++
        console.error('[FAIL] phone-landscape-fullscreen-drawing\n  ' + problemsDraw.join('\n  ') + '\n  geometry=' + JSON.stringify(gDraw))
      } else {
        console.log(`[PASS] phone-landscape-fullscreen-drawing square=${gDraw.square.width.toFixed(0)}x${gDraw.square.height.toFixed(0)} controlsBottom=${gDraw.controls.bottom.toFixed(0)}`)
      }
      const closePoint = await page.probe(() => {
        const el = document.querySelector('[data-testid="map-2d-annotations"] [data-test="pb-annot-close"]')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
      if (!closePoint) { failed++; console.error('[FAIL] phone-landscape-fullscreen-drawing: close button missing') }
      else {
        await page.tap({ ...closePoint, touch: true })
        await delay(500)
        const gClosed = await page.probe(mapPreviewGeometryProbe)
        if (gClosed.controls.bottom > 390 + 1 || Math.abs(gClosed.square.width - gClosed.square.height) > 1) {
          failed++
          console.error(`[FAIL] phone-landscape-fullscreen-drawing-close geometry=${JSON.stringify(gClosed)}`)
        } else if (gFs.square.height > 0 && Math.abs(gClosed.square.height - gFs.square.height) > 4) {
          failed++
          console.error(`[FAIL] phone-landscape-fullscreen-drawing-close: square ${gClosed.square.height.toFixed(0)} did not restore to ${gFs.square.height.toFixed(0)}`)
        } else {
          console.log(`[PASS] phone-landscape-fullscreen-drawing-close square=${gClosed.square.height.toFixed(0)} (restored)`)
        }
      }

      const btnExit = await page.probe(() => {
        const el = document.querySelector('[data-testid="map-2d-fullscreen"]')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
      if (!btnExit) throw new Error('fullscreen button missing for exit tap')
      await page.tap({ ...btnExit, touch: true })
      await page.waitFor(() => !document.fullscreenElement, { timeout: 8000, label: 'map preview fullscreen exit' })
      await delay(300)
      const gExit = await page.probe(mapPreviewGeometryProbe)
      if (gExit.widthError > 1) {
        failed++
        console.error(`[FAIL] phone-landscape-fullscreen-exit: square width ${gExit.square.width.toFixed(1)} != stage width ${gExit.stage.width.toFixed(1)}`)
      } else {
        console.log('[PASS] phone-landscape-fullscreen-exit (square back to full width)')
      }
    }

    for (const scenario of [
      { name: 'phone', width: 844, height: 390, touch: true },
      { name: 'tablet', width: 1024, height: 768, touch: true },
      { name: 'desktop', width: 1280, height: 900, touch: false },
    ]) {
      await page.emulate(scenario)
      await page.goto(`${origin}/?view=map-preview&map=faust&mode=3d&ws-auth=1&debug&assets=${encodeURIComponent(`${origin}/fixture-assets`)}`)
      await page.waitForValue(`!!window.__mapPreviewPane && !!document.querySelector('[data-testid="map-3d-root"]')`, Boolean,
        { label: '3D map preview root', timeout: 30000 })
      await verifyMapPreviewCanvasPersistence(page, scenario)
      if (scenario.name === 'phone') {
        await page.waitForValue(`!!document.querySelector('[data-testid="scene-distance-slider"]')`, Boolean, { label: 'distance slider visible' })
        const slider = await page.probe(() => {
          const el = document.querySelector('[data-testid="scene-distance-slider"]')
          const track = el.querySelector('.scene-dist-track').getBoundingClientRect()
          const r = el.getBoundingClientRect()
          const fs = document.querySelector('[data-testid="map-3d-fullscreen"]').getBoundingClientRect()
          const scene = el.closest('[data-scene-surface]')
          const token = parseFloat(scene ? getComputedStyle(scene).getPropertyValue('--hit-min-comfortable') : '')
          const minHit = Number.isFinite(token) && token > 0 ? token : 44
          const hit = (x) => { const target = document.elementFromPoint(x, track.top + track.height / 2); return target === el || el.contains(target) }
          return { width: r.width, minHit, centerError: Math.abs((r.left + r.right - track.left - track.right) / 2),
            overlap: r.left < fs.right && fs.left < r.right && r.top < fs.bottom && fs.top < r.bottom,
            leftHit: hit(r.left + 2), rightHit: hit(r.right - 2),
            left: { x: r.left + 2, y: track.top + track.height * 0.25 },
            right: { x: r.right - 2, y: track.top + track.height * 0.75 } }
        })
        if (slider.width < slider.minHit - 0.5 || slider.centerError > 1 || slider.overlap || !slider.leftHit || !slider.rightHit) {
          throw new Error(`phone distance slider geometry/hit targets: ${JSON.stringify(slider)}`)
        }
        await page.tap({ ...slider.left, touch: true })
        const near = await page.evaluate(`Number(document.querySelector('[data-testid="scene-distance-slider"]').getAttribute('aria-valuenow'))`)
        await page.tap({ ...slider.right, touch: true })
        const far = await page.evaluate(`Number(document.querySelector('[data-testid="scene-distance-slider"]').getAttribute('aria-valuenow'))`)
        if (near <= far) throw new Error(`distance slider edge touches did not adjust value: near=${near} far=${far}`)
        console.log(`[PASS] phone distance slider width=${slider.width.toFixed(1)}px centered and unobstructed`)
      }
      await page.evaluate(`document.activeElement?.blur()`)
      await page.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'h', code: 'KeyH', windowsVirtualKeyCode: 72 }, page.sessionId)
      await page.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'h', code: 'KeyH', windowsVirtualKeyCode: 72 }, page.sessionId)
      await page.waitForValue(`!!document.querySelector('[data-testid="map-3d-restore-ui"]')`, Boolean, { label: '3D UI hidden' })
      await page.evaluate(`document.querySelector('[data-testid="map-3d-fullscreen"]').scrollIntoView({ block: 'center' })`)
      const points = await page.probe(() => {
        const point = (selector) => {
          const el = document.querySelector(selector)
          const r = el.getBoundingClientRect()
          const x = r.left + r.width / 2, y = r.top + r.height / 2
          const hit = document.elementFromPoint(x, y)
          return { x, y, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, hit: el === hit || el.contains(hit) }
        }
        return { fullscreen: point('[data-testid="map-3d-fullscreen"]'), restore: point('[data-testid="map-3d-restore-ui"]') }
      })
      const a = points.fullscreen.rect, b = points.restore.rect
      if (!points.fullscreen.hit || !points.restore.hit || (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)) {
        throw new Error(`${scenario.name} 3D buttons overlap or are not hit-testable: ${JSON.stringify(points)}`)
      }
      await page.tap({ x: points.fullscreen.x, y: points.fullscreen.y, touch: scenario.touch })
      await page.waitFor(() => !!document.fullscreenElement, { label: `${scenario.name} 3D fullscreen enters` })
      const restore = await page.probe(() => {
        const el = document.querySelector('[data-testid="map-3d-restore-ui"]')
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
      await page.tap({ ...restore, touch: scenario.touch })
      await page.waitForValue(`!document.querySelector('[data-testid="map-3d-restore-ui"]')`, Boolean, { label: `${scenario.name} 3D UI restored` })
      await page.evaluate('document.exitFullscreen()')
      await page.waitFor(() => !document.fullscreenElement, { label: `${scenario.name} 3D fullscreen exits` })
      console.log(`[PASS] map-3d-${scenario.name} fullscreen and restore hit targets`)
    }

    if (page.consoleErrors.length) {
      console.error('page console errors:', page.consoleErrors)
      failed++
    }
    if (failed) {
      console.error(`\n${failed} scenario(s) FAILED`)
      process.exitCode = 1
    } else {
      console.log('\nall map preview layout scenarios passed')
    }
  } finally {
    await chromeCdp.client.send('Target.closeTarget', { targetId }).catch(() => {})
    if (fixture) await fixture.close()
    await chromeCdp.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
