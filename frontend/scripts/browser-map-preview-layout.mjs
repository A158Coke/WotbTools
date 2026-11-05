/**
 * Map Preview 移动布局门禁（真实应用 + 真实 Chrome）。
 *
 * 覆盖 current-plan「Mobile 2D Map Preview」契约：
 *   - 手机形态（PLAYBACK_MOBILE_QUERY）：2D 正方形地图吃满可用宽度、水平居中（≤2px）、
 *     工具区紧随地图（间隙 ≤2px）、无横向溢出、右上角全屏按钮与工具行按钮真实可点；
 *     标注工具开合后几何仍然成立。
 *   - 桌面（≥1200px）：保持「固定填充高度」契约——stage 吃剩余、controls 收在 body 底部。
 *
 * 夹具：startFixtureServer 只替换 Keycloak 边界（同 browser-workspace-interaction），
 * 地图索引 / 封面走 /fixture-assets/* 中间件；faust 走打包注册表底图（无 3D 资产需求）。
 * 真实手势（缩放/平移/标注坐标）不在此门禁范围：由既有 vitest 管线与人工验收覆盖。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')

// 场景矩阵：手机竖屏四档 + 手机横屏 coarse + 桌面回归
const scenarios = [
  { name: 'phone-320x568', width: 320, height: 568, touch: true, phone: true },
  { name: 'phone-360x800', width: 360, height: 800, touch: true, phone: true },
  { name: 'phone-390x844', width: 390, height: 844, touch: true, phone: true },
  { name: 'phone-430x932', width: 430, height: 932, touch: true, phone: true },
  { name: 'phone-landscape-844x390', width: 844, height: 390, touch: true, phone: true },
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
    // 竖屏横屏都可能折叠线以下：按「可滚动触达」口径，滚进视口后再做命中测试
    // （这是几何断言，不涉及真实触点输入；tap 用例只在控件本屏可见时执行）。
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
    // 水平居中（≤2px）
    centerXError: Math.abs((sq.left + sq.right) / 2 - (s.left + s.right) / 2),
    // 手机契约：方形边长 = 舞台可用宽度（不被视口高度预算压缩；空间不足由页面滚动承接）
    widthError: Math.abs(sq.width - s.width),
    // 正方形
    aspectError: Math.abs(sq.width - sq.height),
    // 工具区紧随地图（≤2px）
    mapToControlsGap: c.top - sq.bottom,
    // 无横向溢出
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    fullscreenHit: hitTest(fullscreen),
    // 右上角契约：按钮贴 root 右上角（≤4px）
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
    // 桌面契约：controls 收在固定高度 body 底部
    bodyFillContractError: q('.map2d.map2d-phone')
      ? null
      : (() => {
          const body = q('.map2d-body')
          return body ? Math.abs(rect(body).bottom - c.bottom) : null
        })(),
  }
}

async function openMapPreview(page, origin) {
  await page.goto(`${origin}/?view=map-preview&map=faust&mode=2d&ws-auth=1&assets=${encodeURIComponent(`${origin}/fixture-assets`)}`)
  await page.waitForValue(
    `(() => { const sq = document.querySelector('.map2d-square'); return !!sq && sq.getBoundingClientRect().width > 0 })()`,
    (v) => v === true,
    { label: 'map2d square rendered', timeout: 30_000 },
  )
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
        // 右上角契约：贴角但允许 --space-2（8px）浮动内边距 ±4px
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

      // 标注工具开合后几何仍成立（手机形态工具区高度变化触发重测）。
      // 工具区不在首屏的形态（横屏地图满宽后滚动承接）跳过 tap：scrollIntoView 会
      // 平移 visual viewport 使触点坐标错位（本门禁顶部注释），触屏交互交真机验收。
      if (scenario.phone && g.controls.bottom <= scenario.height) {
        // 不 scrollIntoView：它会平移 visual viewport（offsetTop ≠ 0），让后续触点
        // 坐标与 client 坐标错位。地图 + 工具行在手机档本来就在首屏可见。
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
          // 复位到工具行形态，供下一个场景
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
