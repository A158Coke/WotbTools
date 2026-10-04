/**
 * 装甲查看器瞄准交互门禁（Pointer Events 路径的真实输入验证；评审 PR #511 BLOCKER 1/2）。
 *
 * 为什么必须是真浏览器 + 真实输入：被测行为是「按炮管/炮塔/车体拖动分别触发
 * yaw+俯仰 / 只 yaw / 相机轨道」「短按无拖动 = 判定」「画布外释放不卡死相机控制」
 * ——这些是 Pointer Events 管线与 OrbitControls 的互作，合成 DOM 事件与 happy-dom
 * 都无法复现（合成事件不进 CDP 输入管线，touch 派发的 pointerType 也不同）。
 * 输入全部走 CDP Input.dispatchTouchEvent/MouseEvent（可信事件）。
 *
 * 确定性（评审 BLOCKER 2）：本门禁**自带夹具资产包**（browser-fixtures/fixture-asset-pack.mjs：
 * 进程内起小型资产源，确定性构造 hull / turret_01 / gun_01 / chassis_track_* 几何与
 * tank JSON），任何环境（含 CI，无真实资产）都真实执行——模型加载失败即失败，
 * 不存在 SKIP（旧实现的"资产不可达 → exit 0"让这条 gate 在 CI 里恒绿假阳性）。
 * 本地要对真实车辆人工核对时用环境变量覆盖：
 *   AIM_ASSETS=http://127.0.0.1:8123 AIM_TANK=3201 node scripts/browser-armor-aiming.mjs
 */
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { FIXTURE_TANK_ID, startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'

const useRealAssets = !!process.env.AIM_ASSETS
const TANK = process.env.AIM_TANK || (useRealAssets ? '3201' : String(FIXTURE_TANK_ID))
const failures = []
const check = (ok, msg) => {
  if (ok) console.log(`[armor-aiming] OK: ${msg}`)
  else { failures.push(msg); console.error(`[armor-aiming] FAIL: ${msg}`) }
}

const chrome = findChrome()
const { server, origin } = await startFixtureServer()
const assetPack = useRealAssets ? null : await startFixtureAssetPack()
const assets = process.env.AIM_ASSETS || assetPack.origin
console.log(`[armor-aiming] 资产源: ${useRealAssets ? '真实资产覆盖' : '夹具包'} ${assets}（tank=${TANK}）`)
let chromeCdp = null
let page = null
try {
  chromeCdp = await launchChromeForCdp(chrome, {
    extraArgs: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      // 门禁要求 WebGL2 真的能建上下文（否则装甲舞台走 unsupported 分支、没有可测场景）。
      // 无 GPU 的机器 / CI runner 上允许软件 WebGL 兜底（未知此 flag 的旧版本会忽略它）。
      '--enable-unsafe-swiftshader',
    ],
  })
  const { targetId, sessionId } = await chromeCdp.openPage()
  page = new Page(chromeCdp.client, sessionId)
  await page.enable()
  await page.emulate({ width: 1400, height: 900, touch: false })

  // 固定机位（前右三分之四视角，含俯角）：炮管/炮塔/车体三部位都清晰可见，
  // 部位像素扫描不依赖默认相机（夹具与真实资产都适用）
  const cameraQuery = process.env.AIM_CAMERA || '&az=35&h=2.4&dist=9'
  await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${TANK}&shell=0&heatmap=1${cameraQuery}&assets=${assets}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })

  // 模型就绪门：网格钩子出现且 units 非空。夹具下这是硬断言（失败 = 门禁失败，不 SKIP）
  const ready = await page.waitFor(() => {
    const h = window.__armorRicochet
    return h && h.info() && h.info().meshCount > 0 && !!h.info().grid
  }, { label: 'armor model + ricochet grid', timeout: 30000 }).catch(() => false)
  check(ready === true, `车模与续飞网格就绪（meshCount>0 且 grid 非空；旧实现此处静默 SKIP）`)
  if (!ready) {
    for (const line of await page.diagnose()) console.error(`[armor-aiming]   ${line}`)
    throw new Error('model never became ready')
  }
  const info = await page.evaluate('window.__armorRicochet.info()')
  check(info.enabled === true, `续飞通道启用（enabled=${info.enabled} reason=${info.reason || ''}）`)
  await delay(800)

  // —— 找三类部位像素（client 坐标）：炮管 / 炮塔壳 / 车体 ——
  // need 可裁剪（触屏视口窄，转动后炮管可能出画/被遮挡时只要求用得到的部位）
  const findSpotsExpr = (need) => `(() => {
    const H = window.__armorRicochet;
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const need = ${JSON.stringify(need)};
    let gun = null, turret = null, hull = null;
    for (let cy = 20; cy < c.height - 20; cy += 4) {
      for (let cx = 20; cx < c.width - 20; cx += 4) {
        const hits = H.__raytrace(r.left + cx, r.top + cy);
        if (!hits || !hits.length) continue;
        const n = hits[0].name;
        if (!gun && /^gun_/.test(n)) gun = { x: r.left + cx, y: r.top + cy, name: n };
        if (!turret && /^turret_/.test(n)) turret = { x: r.left + cx, y: r.top + cy, name: n };
        if (!hull && /^hull_/.test(n)) hull = { x: r.left + cx, y: r.top + cy, name: n };
        const ok = need.every((p) => ({ gun, turret, hull })[p]);
        if (ok) break;
      }
      const ok = need.every((p) => ({ gun, turret, hull })[p]);
      if (ok) break;
    }
    return { gun, turret, hull };
  })()`
  const findSpots = (need = ['gun', 'turret', 'hull']) => page.evaluate(findSpotsExpr(need))

  const spots = await findSpots()
  check(!!spots.gun && !!spots.turret && !!spots.hull,
    `部位样本像素齐备 gun=${spots.gun?.name} turret=${spots.turret?.name} hull=${spots.hull?.name}`)
  if (!(spots.gun && spots.turret && spots.hull)) throw new Error('fixture geometry has no gun/turret/hull pixels')
  const readAim = () => page.evaluate(`(() => ({
    t: document.getElementById('turret-val').textContent,
    g: document.getElementById('gun-val').textContent,
  }))()`)
  const readJudgments = async () => (await page.evaluate('window.__armorRicochet.info()')).judgments
  const shotPanel = () => page.evaluate(`(() => {
    const el = document.getElementById('traj-info');
    return { visible: !!el && el.style.display !== 'none', text: (el && el.textContent || '').slice(0, 60) };
  })()`)

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
  const mouseTap = async (point) => {
    const cdp = chromeCdp.client
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, sessionId)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId)
    await delay(60)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId)
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

  /**
   * 双指缩放（评审 BLOCKER：炮塔/炮管上的第一根手指不得吃掉 pinch）。
   * 第一根手指按在部位上（from），第二根落下（距离 ~140px）后收拢/张开 → OrbitControls
   * 的 TOUCH_DOLLY_PAN 生效。断言：手指落位时不进入瞄准、controls 保持启用；捏合改变相机
   * 距离；炮塔/炮管角度不变；不触发装甲判定；手势结束后状态干净。
   * direction：'converge'（收拢 = 拉远）/ 'diverge'（张开 = 拉近）——相机距离有
   * [minDistance=3, maxDistance=30] 钳制，用例需按当前距离选方向（贴到钳制值即无变化）。
   */
  const canvasRect = () => page.evaluate(`(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  })()`)
  const pinchZoom = async (label, from, dx, dy, direction = 'converge') => {
    const cdp = chromeCdp.client
    const rect = await canvasRect()
    const clamp = (p) => ({
      x: Math.round(Math.min(rect.right - 16, Math.max(rect.left + 16, p.x))),
      y: Math.round(Math.min(rect.bottom - 16, Math.max(rect.top + 16, p.y))),
    })
    const second = clamp({ x: from.x + dx, y: from.y + dy })
    const scale = direction === 'diverge' ? 1.8 : 0.25
    const secondEnd = clamp({ x: from.x + dx * scale, y: from.y + dy * scale })
    const pts = (list) => list.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 8, radiusY: 8, force: 1 }))
    const state0 = await page.evaluate('window.__armorRicochet.aimingState()')
    const aim0 = await readAim()
    const j0 = await readJudgments()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts([from]) }, sessionId)
    await delay(60)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts([from, second]) }, sessionId)
    await delay(80)
    const stateSecond = await page.evaluate('window.__armorRicochet.aimingState()')
    for (let i = 1; i <= 5; i++) {
      const p2 = {
        x: Math.round(second.x + (secondEnd.x - second.x) * i / 5),
        y: Math.round(second.y + (secondEnd.y - second.y) * i / 5),
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts([from, p2]) }, sessionId)
      await delay(30)
    }
    // 等距离真的变化（同样不靠固定 delay：触屏 pointermove 按帧合并，慢渲染下会晚到）
    const dollyChanged = await page.waitForValue('window.__armorRicochet.aimingState().cameraDistance',
      (v) => Math.abs(v - state0.cameraDistance) > 0.05, { timeout: 3000, label: 'pinch dolly' })
      .then((v) => v).catch(() => null)
    const state1 = await page.evaluate('window.__armorRicochet.aimingState()')
    const aim1 = await readAim()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId)
    await delay(250)
    const stateEnd = await page.evaluate('window.__armorRicochet.aimingState()')
    const j1 = await readJudgments()
    check(stateSecond.aiming === false && stateSecond.controlsEnabled === true,
      `${label}：部位上的第一根手指不进入瞄准、OrbitControls 保持启用（aiming=${stateSecond.aiming} controls=${stateSecond.controlsEnabled}）`)
    check(dollyChanged !== null && Math.abs(state1.cameraDistance - state0.cameraDistance) > 0.05,
      `${label}：双指捏合改变相机距离（${state0.cameraDistance} → ${dollyChanged ?? state1.cameraDistance}）`)
    check(aim1.t === aim0.t && aim1.g === aim0.g,
      `${label}：炮塔/炮管角度不变（${aim0.t}/${aim0.g}）`)
    check(j1 === j0, `${label}：双指手势不触发装甲判定（judgments ${j0}→${j1}）`)
    check(stateEnd.aiming === false && stateEnd.controlsEnabled === true,
      `${label}：手势结束后状态干净（aiming=${stateEnd.aiming} controls=${stateEnd.controlsEnabled}）`)
  }

  // —— 交互分支断言 ——
  // 注意：炮塔/炮管一旦转动，之前扫描到的部位像素会移到别处（`aimPartAt` 按当前几何判定，
  // 陈旧像素会落进错误的部位分支）。每次操作前重新扫描，断言才指向真实部位。
  const rescan = async (label) => {
    const next = await findSpots()
    if (!(next.gun && next.turret && next.hull)) {
      check(false, `${label}：重新扫描部位像素失败（${JSON.stringify(next)}）`)
    }
    return next
  }

  {
    const s = spots
    const beforeTurret = await readAim()
    await mouseDrag(s.turret, 150, 60)
    const afterTurret = await readAim()
    check(afterTurret.t !== beforeTurret.t && afterTurret.g === beforeTurret.g,
      `鼠标·炮塔壳拖动 = 只 yaw 不俯仰（${beforeTurret.t}/${beforeTurret.g} → ${afterTurret.t}/${afterTurret.g}）`)
  }
  {
    const s = await rescan('炮管拖动前')
    const before = await readAim()
    await mouseDrag(s.gun, 150, 60)
    const after = await readAim()
    check(after.t !== before.t && after.g !== before.g,
      `鼠标·炮管拖动 = yaw+俯仰（${before.t}/${before.g} → ${after.t}/${after.g}）`)
  }

  // 车体拖动 = 相机分支。断言行为分支而非角度：装甲判定为车体的像素，视觉上可能被
  // 炮塔皮肤覆盖（视觉组语义下判炮塔是正确行为）——按下瞬间的 aiming 态才是分支的权威证据
  {
    const s = await rescan('车体拖动前')
    const cdp = chromeCdp.client
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.hull.x, y: s.hull.y }, sessionId)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.hull.x, y: s.hull.y, button: 'left', clickCount: 1 }, sessionId)
    await delay(120)
    const st = await page.evaluate('window.__armorRicochet.aimingState()')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.hull.x + 40, y: s.hull.y, button: 'left', clickCount: 1 }, sessionId)
    await delay(200)
    const st2 = await page.evaluate('window.__armorRicochet.aimingState()')
    check(st.aiming === false && st2.aiming === false && st2.controlsEnabled === true,
      `车体/空白拖动 = 相机分支（aiming=${st.aiming}）且 controls 可用`)
  }

  // —— 短按（无拖动）= 判定：炮塔 / 炮管上短按同样触发（评审 BLOCKER 1 回归）——
  // 断言口径 = 判定代数计数（#traj-info 面板被渲染循环持续重新显示，display 不可判新判定）
  {
    const s = await rescan('短按前')
    for (const part of ['gun', 'turret', 'hull']) {
      const n0 = await readJudgments()
      const angleBefore = await readAim()
      await mouseTap(s[part])
      const n1 = await readJudgments()
      const panel = await shotPanel()
      const angleAfter = await readAim()
      check(n1 === n0 + 1 && panel.visible === true,
        `短按·${part} 触发判定（judgments ${n0}→${n1}，面板 "${panel.text.trim().slice(0, 36)}"）`)
      if (part !== 'hull') {
        check(angleAfter.t === angleBefore.t && angleAfter.g === angleBefore.g,
          `短按·${part} 不产生瞄准手势（角度 ${angleBefore.t}/${angleBefore.g} 不变）`)
      }
    }
    // 拖动 = 手势，不触发判定（同一修复的另一半语义）
    const s2 = await rescan('手势判定前')
    const n0 = await readJudgments()
    await mouseDrag(s2.turret, 120, 40)
    const n1 = await readJudgments()
    check(n1 === n0, `拖动（炮塔/炮管上）= 手势不触发判定（judgments ${n0}→${n1}）`)
    const s3 = await rescan('相机拖动判定前')
    const m0 = await readJudgments()
    await mouseDrag(s3.hull, 120, 40)
    const m1 = await readJudgments()
    check(m1 === m0, `拖动（车体上）= 相机不触发判定（judgments ${m0}→${m1}）`)
  }

  // —— 双指缩放（评审 BLOCKER：炮塔/炮管上的第一根手指不得吃掉 pinch）——
  // 触屏路由此处起才启用触屏仿真（前面的鼠标分支保持鼠标语义）；第一指按部位、第二指收拢。
  await page.emulate({ width: 1400, height: 900, touch: true })
  await delay(300)
  {
    const s = await rescan('炮管 pinch 前')
    await pinchZoom('炮管上起手的双指缩放', s.gun, 130, 70)
  }

  // —— 触屏（Pointer Events 触屏路径；评审 BLOCKER 1）——
  // 触屏视口窄且炮塔已转过：只要求用得到的部位（转动后炮管可能出画）
  await page.emulate({ width: 390, height: 844, touch: true })
  await delay(400)
  const spots2 = await findSpots(['turret'])
  if (spots2.turret) {
    const beforeT = await readAim()
    await touchDrag(spots2.turret, 120, 0)
    const afterT = await readAim()
    check(afterT.t !== beforeT.t && afterT.g === beforeT.g,
      `触屏·炮塔壳拖动 = 只 yaw（Pointer Events 路径，${beforeT.t} → ${afterT.t}）`)
  } else {
    check(false, '触屏视口下未找到炮塔像素（夹具几何/机位异常）')
  }
  {
    // 炮塔上起手的双指缩放（手机档；与桌面档的炮管 pinch 共同覆盖两个部位）。
    // 方向取「张开」（拉近）：桌面档 pinch 已把距离推到 23+，收拢会撞 maxDistance=30 钳制。
    const s = await findSpots(['turret'])
    if (s.turret) await pinchZoom('触屏·炮塔上起手的双指缩放', s.turret, 90, 60, 'diverge')
    else check(false, '触屏视口下未找到炮塔像素（pinch 用例）')
  }
  {
    const s = await findSpots(['hull'])
    if (s.hull) {
      const cdp = chromeCdp.client
      const pt = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(s.hull.x, s.hull.y) }, sessionId)
      await delay(120)
      const st = await page.evaluate('window.__armorRicochet.aimingState()')
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId)
      await delay(200)
      check(st.aiming === false, `触屏·车体拖动 = 相机分支（aiming=${st.aiming}）`)
    } else {
      check(false, '触屏视口下未找到车体像素')
    }
  }

  // —— 画布外释放（评审 BLOCKER 2：pointer capture 保证清理）——
  {
    const s = await findSpots(['turret'])
    if (s.turret) {
      const cdp = chromeCdp.client
      const from = s.turret
      const pt = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) }, sessionId)
      await delay(60)
      // 先在画布内移动过阈值完成 claim（触屏是延迟 claim：按下只记候选，移动才进入瞄准）。
      // **等状态而不是等时钟**：Chrome 的触屏 pointermove 按帧合并派发，CI 无 GPU 渲染慢时
      // 固定 delay 会读到「事件还没送到」的中间态（18872f5c 与 67f3a01a 两次 CI 失败均源于此）。
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + 24, from.y) }, sessionId)
      const claimed = await page.waitForValue('window.__armorRicochet.aimingState().aiming', (v) => v === true,
        { timeout: 5000, label: 'touch aim claim' }).then(() => true).catch(() => false)
      check(claimed, `画布内移动过阈值即 claim 瞄准（aiming=${claimed}）`)
      // claim 已确认后再拖出视口顶部：验证的是 capture 语义本身（会话不因指针离开画布而丢）
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + 24, -40) }, sessionId)
      await delay(80)
      const mid = await page.evaluate('window.__armorRicochet.aimingState()')
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId)
      await page.waitForValue(
        'window.__armorRicochet.aimingState().aiming === false && window.__armorRicochet.aimingState().controlsEnabled === true',
        (v) => v === true, { timeout: 3000, label: 'session cleanup' }).catch(() => {})
      const st = await page.evaluate('window.__armorRicochet.aimingState()')
      check(mid.aiming === true, '画布外拖动中 aiming 保持（capture 生效）')
      check(st.aiming === false && st.controlsEnabled === true,
        `画布外释放后清理完整（aiming=${st.aiming} controls=${st.controlsEnabled}）`)
    }
  }

  await chromeCdp.client.send('Target.closeTarget', { targetId })
} catch (error) {
  failures.push(`脚本异常：${error.message}`)
  if (page) for (const line of await page.diagnose().catch(() => [])) console.error(`[armor-aiming]   ${line}`)
} finally {
  try { if (chromeCdp?.close) await chromeCdp.close() } catch (_) {}
  if (assetPack) await assetPack.close()
  await server.close()
}

if (failures.length) {
  console.error(`[armor-aiming] ${failures.length} 项失败`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('[armor-aiming] all scenarios passed')
