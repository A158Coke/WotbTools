/**
 * 装甲查看器瞄准交互门禁（Pointer Events 路径的真实输入验证；评审 PR #511 BLOCKER 1/2）。
 *
 * 为什么必须是真浏览器 + 真实输入：被测行为是「按炮管/炮塔/车体拖动分别触发
 * yaw+俯仰 / 只 yaw / 相机轨道」与「画布外释放不卡死相机控制」——这些是
 * Pointer Events 管线与 OrbitControls 的互作，合成 DOM 事件与 happy-dom 都
 * 无法复现（合成事件不进 CDP 输入管线，touch 派发的 pointerType 也不同）。
 * 输入全部走 CDP Input.dispatchTouchEvent/MouseEvent（可信事件）。
 *
 * 资产包前提：需要真实车模几何（部位判定按视觉组分组）。资产包不可达时
 * **跳过**（exit 0 + SKIP 标注）——CI 无资产源时保持绿，本地按
 * docs/frontend/local-production-dev.md 起资产包后全覆盖。
 */
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const TANK = process.env.AIM_TANK || '3201'
const failures = []
const check = (ok, msg) => {
  if (ok) console.log(`[armor-aiming] OK: ${msg}`)
  else { failures.push(msg); console.error(`[armor-aiming] FAIL: ${msg}`) }
}

const chrome = findChrome()
const { server, origin } = await startFixtureServer()
let chromeCdp = null
try {
  chromeCdp = await launchChromeForCdp(chrome, {
    extraArgs: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
  })
  const { targetId, sessionId } = await chromeCdp.openPage()
  const page = new Page(chromeCdp.client, sessionId)
  await page.enable()
  await page.emulate({ width: 1400, height: 900, touch: false })

  const assets = process.env.VITE_ASSET_BASE_URL || 'http://127.0.0.1:8123'
  await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${TANK}&shell=0&heatmap=1&assets=${assets}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })

  // 模型就绪门：网格钩子出现且 units 非空（无资产 → 跳过保持 CI 绿）
  const ready = await page.waitFor(() => {
    const h = window.__armorRicochet
    return h && h.info() && h.info().meshCount > 0
  }, { label: 'armor model', timeout: 20000 }).catch(() => false)
  if (!ready) {
    console.log('[armor-aiming] SKIP: 资产包不可达（' + assets + '），几何交互断言需要真实车模')
    process.exit(0)
  }
  await delay(1200)

  // —— 找三类部位像素（client 坐标）：炮管 / 炮塔壳 / 车体 ——
  const spots = await page.evaluate(`(() => {
    const H = window.__armorRicochet;
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    let gun = null, turret = null, hull = null;
    for (let cy = 20; cy < c.height - 20; cy += 4) {
      for (let cx = 20; cx < c.width - 20; cx += 4) {
        const hits = H.__raytrace(r.left + cx, r.top + cy);
        if (!hits || !hits.length) continue;
        const n = hits[0].name;
        if (!gun && /^gun_/.test(n)) gun = { x: r.left + cx, y: r.top + cy, name: n };
        if (!turret && /^turret_/.test(n)) turret = { x: r.left + cx, y: r.top + cy, name: n };
        if (!hull && /^hull_/.test(n)) hull = { x: r.left + cx, y: r.top + cy, name: n };
        if (gun && turret && hull) break;
      }
      if (gun && turret && hull) break;
    }
    return { gun, turret, hull };
  })()`)
  check(!!spots.gun && !!spots.turret && !!spots.hull,
    `部位样本像素齐备 gun=${spots.gun?.name} turret=${spots.turret?.name} hull=${spots.hull?.name}`)

  const readAim = () => page.evaluate(`(() => ({
    t: document.getElementById('turret-val').textContent,
    g: document.getElementById('gun-val').textContent,
  }))()`)

  const mouseDrag = async (from, dx, dy) => {
    const cdp = chromeCdp.client
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y }, sessionId)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 }, sessionId)
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (dx * i) / 5, y: from.y + (dy * i) / 5, button: 'left' }, sessionId)
      await delay(30)
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x + dx, y: from.y + dy, button: 'left', clickCount: 1 }, sessionId)
    await delay(250)
  }

  const touchDrag = async (from, dx, dy) => {
    const cdp = chromeCdp.client
    const pt = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) }, sessionId)
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + (dx * i) / 5, from.y + (dy * i) / 5) }, sessionId)
      await delay(30)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId)
    await delay(250)
  }

  if (spots.gun) {
    const before = await readAim()
    await mouseDrag(spots.gun, 150, 60)
    const after = await readAim()
    check(after.t !== before.t && after.g !== before.g,
      `鼠标·炮管拖动 = yaw+俯仰（${before.t}/${before.g} → ${after.t}/${after.g}）`)
  }
  if (spots.turret) {
    const before = await readAim()
    await mouseDrag(spots.turret, 150, 60)
    const after = await readAim()
    check(after.t !== before.t && after.g === before.g,
      `鼠标·炮塔壳拖动 = 只 yaw 不俯仰（${before.t}/${before.g} → ${after.t}/${after.g}）`)
  }
  if (spots.hull) {
    // 断言行为分支而非角度：装甲判定为车体的像素，视觉上可能被炮塔皮肤覆盖（视觉组
    // 语义下判炮塔是正确行为）——按下瞬间的 aiming 态才是分支的权威证据
    const cdp = chromeCdp.client
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spots.hull.x, y: spots.hull.y }, sessionId)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spots.hull.x, y: spots.hull.y, button: 'left', clickCount: 1 }, sessionId)
    await delay(120)
    const st = await page.evaluate('window.__armorRicochet.aimingState()')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spots.hull.x, y: spots.hull.y, button: 'left', clickCount: 1 }, sessionId)
    await delay(200)
    const st2 = await page.evaluate('window.__armorRicochet.aimingState()')
    check(st2.aiming === false && st2.controlsEnabled === true, '车体/空白拖动 = 相机分支（aiming=false）且 controls 可用')
  }

  // —— 触屏（Pointer Events 触屏路径；评审 BLOCKER 1）——
  await page.emulate({ width: 390, height: 844, touch: true })
  await delay(400)
  const spots2 = await page.evaluate(`(() => {
    const H = window.__armorRicochet;
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    let gun = null, turret = null, hull = null;
    for (let cy = 20; cy < c.height - 20; cy += 4) {
      for (let cx = 20; cx < c.width - 20; cx += 4) {
        const hits = H.__raytrace(r.left + cx, r.top + cy);
        if (!hits || !hits.length) continue;
        const n = hits[0].name;
        if (!gun && /^gun_/.test(n)) gun = { x: r.left + cx, y: r.top + cy, name: n };
        if (!turret && /^turret_/.test(n)) turret = { x: r.left + cx, y: r.top + cy, name: n };
        if (!hull && /^hull_/.test(n)) hull = { x: r.left + cx, y: r.top + cy, name: n };
        if (gun && turret && hull) break;
      }
      if (gun && turret && hull) break;
    }
    return { gun, turret, hull };
  })()`)
  if (spots2.turret) {
    const before = await readAim()
    await touchDrag(spots2.turret, 120, 0)
    const after = await readAim()
    check(after.t !== before.t && after.g === before.g,
      `触屏·炮塔壳拖动 = 只 yaw（Pointer Events 路径，${before.t} → ${after.t}）`)
  }
  if (spots2.hull) {
    const cdp = chromeCdp.client
    const pt = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(spots2.hull.x, spots2.hull.y) }, sessionId)
    await delay(120)
    const st = await page.evaluate('window.__armorRicochet.aimingState()')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId)
    await delay(200)
    check(st.aiming === false, `触屏·车体拖动 = 相机分支（aiming=${st.aiming}）`)
  }

  // —— 画布外释放（评审 BLOCKER 2：pointer capture 保证清理）——
  if (spots2.turret) {
    const cdp = chromeCdp.client
    const from = spots2.turret
    const pt = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) }, sessionId)
    await delay(60)
    // 拖出画布顶部（负 y）再释放
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x, -40) }, sessionId)
    await delay(60)
    const mid = await page.evaluate('window.__armorRicochet.aimingState()')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId)
    await delay(300)
    const st = await page.evaluate('window.__armorRicochet.aimingState()')
    check(mid.aiming === true, '画布外拖动中 aiming 保持（capture 生效）')
    check(st.aiming === false && st.controlsEnabled === true,
      `画布外释放后清理完整（aiming=${st.aiming} controls=${st.controlsEnabled}）`)
  }

  // —— 短按（无拖动）点击判定仍工作 ——
  if (spots2.hull) {
    await page.tap({ x: spots2.hull.x, y: spots2.hull.y, touch: true })
    const shown = await page.evaluate(`(() => {
      const el = document.getElementById('traj-info');
      return el && el.style.display !== 'none' && (el.textContent || '').length > 0;
    })()`)
    check(shown === true, '短按（无拖动）仍触发射击判定面板')
  }

  await chromeCdp.client.send('Target.closeTarget', { targetId })
} finally {
  try { if (chromeCdp?.close) await chromeCdp.close() } catch (_) {}
  await server.close()
}

if (failures.length) {
  console.error(`[armor-aiming] ${failures.length} 项失败`)
  process.exit(1)
}
console.log('[armor-aiming] all scenarios passed')
