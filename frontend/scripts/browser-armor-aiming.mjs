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
 *
 * 唯一的模式条件例外：**夹具专属场景**（仅间隙甲命中 → 不构成判定）依赖夹具特意构造的
 * 悬空间隙甲屏幕板，真实资产覆盖下车辆不保证有间隙甲板，扫不到即跳过——跳过是模式条件，
 * 不是"资产不可达即绿"；夹具模式（CI 默认）找不到屏幕仍然硬失败。
 */
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { FIXTURE_TANK_ID, startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'
// 判定触发面（Primary = 主装甲板）与产品同源：射线未触达 Primary 的点击不构成判定
//（BlitzKit 的 shoot() 只挂在 Primary 网格上）。门禁断言依赖这份分类，勿在脚本里另抄一份。
import { ArmorSection, isPrimary } from '../src/scene/penetration.js'

const useRealAssets = !!process.env.AIM_ASSETS
const TANK = process.env.AIM_TANK || (useRealAssets ? '3201' : String(FIXTURE_TANK_ID))
const PRIMARY_SECTIONS = [ArmorSection.HULL, ArmorSection.TURRET, ArmorSection.GUN]
if (!PRIMARY_SECTIONS.every(isPrimary) || isPrimary(ArmorSection.SPACED) || isPrimary(ArmorSection.CHASSIS)) {
  throw new Error('判定模块的 Primary 分类与门禁假设不一致（penetration.js isPrimary）')
}
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
  await page.emulate({ width: 1400, height: 900, touch: false, deviceScaleFactor: 1 })

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
  // 部位采样必须同时满足两条：可视化第一命中名（__raytrace 的报告面）与**产品同一分类器**
  // __aimPart 的结论一致——只按名字采样会在视觉模型/装甲模型命中顺序不一致时取到
  // "看着是炮塔、按下却落进车体/相机分支"的像素，让断言在 CI 上随机翻车。
  // 每个部位**优先**取「射线触达主装甲板」的像素（短按必出结论，断言最强）；真实资产覆盖下
  // 某部位可能只有仅触达间隙甲/外部模块的像素（如炮管悬空、其装甲板全归 spaced）——此时退回
  // 该像素并记 primary:false，由调用方按"不构成判定（面板无结论）"断言（BlitzKit 触发面语义）。
  // need 可裁剪（触屏视口窄，转动后炮管可能出画/被遮挡时只要求用得到的部位）
  const findSpotsExpr = (need) => `(() => {
    const H = window.__armorRicochet;
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const need = ${JSON.stringify(need)};
    const PRIMARY = ${JSON.stringify(PRIMARY_SECTIONS)};
    const found = { gun: null, turret: null, hull: null };      // 首选：射线触达主装甲
    const fallback = { gun: null, turret: null, hull: null };   // 次选：仅间隙甲/外部模块
    const scan = (step) => {
      for (let cy = 20; cy < c.height - 20; cy += step) {
        for (let cx = 20; cx < c.width - 20; cx += step) {
          const px = r.left + cx, py = r.top + cy;
          const hits = H.__raytrace(px, py);
          if (!hits || !hits.length) continue;
          const n = hits[0].name;
          const cls = H.__aimPart(px, py);
          const primary = hits.some((h) => PRIMARY.includes(h.sec));
          const take = (part, rec) => {
            if (found[part] || fallback[part]) return;
            (primary ? found : fallback)[part] = rec;
          };
          if (/^gun_/.test(n) && cls === 'gun') take('gun', { x: px, y: py, name: n, cls, primary });
          if (/^turret_/.test(n) && cls === 'turret') take('turret', { x: px, y: py, name: n, cls, primary });
          if (/^hull_/.test(n) && cls === null) take('hull', { x: px, y: py, name: n, cls: 'camera', primary });
          if (need.every((p) => found[p])) return true;
        }
      }
      return false;
    };
    // 先粗后细：步长 8 已足够命中（最细的炮管在屏上也有 ~20px 宽），漏找才回退步长 4。
    // 全画布逐像素双射线（__raytrace + __aimPart）在 CI 的 3fps runner 上要 20s+，粗扫省 4 倍。
    // 仅当某部位连"首选"像素都没有时才细扫（次选已找到不触发细扫，避免无谓整帧扫描）。
    if (!scan(8)) scan(4);
    return { gun: found.gun || fallback.gun, turret: found.turret || fallback.turret, hull: found.hull || fallback.hull };
  })()`
  const findSpots = async (need = ['gun', 'turret', 'hull']) => {
    // 采样前等视图静止：damping 让相机在拖动/捏合后继续滑行（慢渲染下数秒），滑行中采到的
    // 部位像素在按下时可能已滑成别的部位 → 断言随机翻车。阈值 = max(400ms, 3×帧间隔)。
    await page.waitForValue(`(() => {
      const s = window.__armorRicochet.aimingState();
      return s.cameraSettledMs > Math.max(400, 3 * s.frameIntervalMs);
    })()`, (v) => v === true, { timeout: 20000, label: 'camera settle' }).catch(() => {})
    return page.evaluate(findSpotsExpr(need))
  }

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

  /**
   * 「仅间隙甲命中」像素：射线首命中是间隙甲，且整条射线不含任何主装甲板
   * （hull/turret/gun）—— BlitzKit 语义下这类点击不构成判定。夹具的屏幕板
   * turret_01_armor_2（12mm 间隙甲，悬在车外、其后是空域）专门构造该几何。
   * 同时要求像素没被固定 UI 覆盖（elementFromPoint 落在画布上），否则点击进不了场景。
   */
  const findScreenOnlyPixel = async () => page.evaluate(`(() => {
    const H = window.__armorRicochet;
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const PRIMARY = ${JSON.stringify(PRIMARY_SECTIONS)};
    for (let cy = Math.round(c.height * 0.18); cy < Math.round(c.height * 0.8); cy += 6) {
      for (let cx = Math.round(c.width * 0.25); cx < Math.round(c.width * 0.75); cx += 6) {
        const px = r.left + cx, py = r.top + cy;
        const hits = H.__raytrace(px, py);
        if (!hits || !hits.length) continue;
        if (hits[0].sec !== 'spaced') continue;
        if (hits.some((h) => PRIMARY.includes(h.sec))) continue;
        const el = document.elementFromPoint(px, py);
        if (!el || (el !== c && !c.contains(el))) continue;
        return { x: px, y: py, name: hits[0].name, layers: hits.length };
      }
    }
    return null;
  })()`)

  const mouseDrag = async (from, dx, dy) => {
    const cdp = chromeCdp.client
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y }, sessionId)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 }, sessionId)
    for (let i = 1; i <= 3; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (dx * i) / 3, y: from.y + (dy * i) / 3, button: 'left' }, sessionId)
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
    for (let i = 1; i <= 3; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + (dx * i) / 3, from.y + (dy * i) / 3) }, sessionId)
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
    for (let i = 1; i <= 3; i++) {
      const p2 = {
        x: Math.round(second.x + (secondEnd.x - second.x) * i / 3),
        y: Math.round(second.y + (secondEnd.y - second.y) * i / 3),
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

  // —— 仅间隙甲命中（射线未触达主装甲）= 不构成判定（BlitzKit 触发面语义）——
  // 回归：只穿间隙甲屏幕的射线若照常判定，「末层被穿透」规则会给出 PENETRATION + 全额伤害，
  // 把「只打穿一块屏幕」显示成击穿整车（实车 56TP 炮塔 10mm 屏幕板 plate 12 即此类）。
  // 位置要求：下面的拖动用例会环绕相机、转动炮塔，而屏幕板的可见像素依赖 URL 固定机位——
  // 本场景必须排在它们之前，且只做短按（不改相机/炮塔姿态），因此复用刚采样的 hull 像素。
  // 模式：本场景依赖夹具特意构造的悬空间隙甲屏幕板（turret_01_armor_2）。真实资产覆盖
  // （AIM_ASSETS/AIM_TANK）下车辆不保证有间隙甲板——无板时扫不到像素属预期，跳过（否则
  // 会让原本可用的覆盖模式误报失败）；夹具模式（CI 默认）找不到屏幕仍硬失败。
  if (useRealAssets) {
    console.log('[armor-aiming] 跳过（模式条件）：真实资产覆盖不保证存在间隙甲屏幕板，'
      + '「仅间隙甲命中」回归由夹具模式（CI 默认，不带 AIM_ASSETS）覆盖')
  } else {
    const spot = await findScreenOnlyPixel()
    if (!spot) {
      check(false, '未找到「仅间隙甲命中」的像素（夹具屏幕板 turret_01_armor_2 / 机位异常）')
    } else {
      await mouseTap(spots.hull)   // 前置：先留下一个在屏结论，确保「不显示」不是「本来就没有」
      const before = await shotPanel()
      check(before.visible === true, `屏幕场景前置：车体短按留下在屏结论（"${before.text.trim().slice(0, 24)}"）`)
      const n0 = await readJudgments()
      await mouseTap(spot)
      const n1 = await readJudgments()
      const after = await shotPanel()
      check(n1 === n0 + 1, `短按·间隙甲屏幕到达判定路径（judgments ${n0}→${n1}，命中 ${spot.name}，${spot.layers} 层）`)
      check(after.visible === false, `短按·间隙甲屏幕不构成判定：面板不显示结论（DOM 缓存文本 "${after.text.trim().slice(0, 24)}" 不可见，不计）`)
    }
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
  // 断言口径 = 判定代数计数（#traj-info 面板被渲染循环持续重新显示，display 不可判新判定）。
  // 结论面按像素证据分档：射线触达主装甲 → 面板必须出结论；只触达间隙甲/外部模块（primary:false，
  // 真实资产覆盖下炮管装甲全归 spaced 时会出现）→ 按 BlitzKit 触发面语义必须无结论。
  {
    const s = await rescan('短按前')
    for (const part of ['gun', 'turret', 'hull']) {
      const n0 = await readJudgments()
      const angleBefore = await readAim()
      await mouseTap(s[part])
      const n1 = await readJudgments()
      const panel = await shotPanel()
      const angleAfter = await readAim()
      check(n1 === n0 + 1, `短按·${part} 到达判定路径（judgments ${n0}→${n1}，命中 ${s[part].name}）`)
      if (s[part].primary === false) {
        check(panel.visible === false,
          `短按·${part} 仅触达间隙甲/外部模块：不构成判定，面板无结论（命中 ${s[part].name}）`)
      } else {
        check(panel.visible === true,
          `短按·${part} 触发判定：面板出结论（"${panel.text.trim().slice(0, 36)}"）`)
      }
      if (part !== 'hull') {
        check(angleAfter.t === angleBefore.t && angleAfter.g === angleBefore.g,
          `短按·${part} 不产生瞄准手势（角度 ${angleBefore.t}/${angleBefore.g} 不变）`)
      }
    }
    // 拖动 = 手势，不触发判定（同一修复的另一半语义）；短按三连不做任何位姿变化，采样沿用
    const s2 = s
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
  await page.emulate({ width: 1400, height: 900, touch: true, deviceScaleFactor: 1 })
  await delay(300)
  {
    const s = await rescan('炮管 pinch 前')
    await pinchZoom('炮管上起手的双指缩放', s.gun, 130, 70)
  }

  // —— 触屏（Pointer Events 触屏路径；评审 BLOCKER 1）——
  // 触屏视口窄且炮塔已转过：只要求用得到的部位（转动后炮管可能出画）
  await page.emulate({ width: 390, height: 844, touch: true, deviceScaleFactor: 1 })
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
    // 车体按压用例：pinch 之后相机已变，需要重新采样；这一次把 turret/hull 一起取足，
    // 供「画布外释放」复用（两者之间没有新的相机动/转角动作，采样不会失效）。
    const s = await findSpots(['hull', 'turret'])
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

    // —— 画布外释放（评审 BLOCKER 2：pointer capture 保证清理）——
    const from = s.turret
    if (from) {
      const cdp = chromeCdp.client
      // 诊断（CI 失败时自解释）：采样像素的命中/分类 + 落点元素 + 手势前的会话态
      const diag = await page.evaluate(`(() => {
        const H = window.__armorRicochet;
        const el = document.elementFromPoint(${from.x}, ${from.y});
        return {
          spot: H.__raytrace(${from.x}, ${from.y}).slice(0, 2),
          part: H.__aimPart(${from.x}, ${from.y}),
          element: el ? el.tagName + '#' + (el.id || '') + '.' + (typeof el.className === 'string' ? el.className : '') : null,
          state: H.aimingState(),
        };
      })()`)
      console.log(`[armor-aiming] 画布外用例现场: ${JSON.stringify(diag)}`)
      check(diag.part === 'turret' && diag.state.session.active === null,
        `画布外用例前置：采样像素分类 turret（得 ${diag.part}）且会话空闲（active=${diag.state.session.active}）`)
      const pt = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }]
      // 事件级现场（失败时自解释）：canvas 捕获阶段记录本次手势的 pointer 事件序列
      await page.evaluate(`(() => {
        const c = document.querySelector('canvas');
        window.__ev = [];
        for (const t of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture']) {
          c.addEventListener(t, (e) => window.__ev.push({ t, id: e.pointerId, type: e.pointerType, x: Math.round(e.clientX), y: Math.round(e.clientY), btn: e.button }), true);
        }
        return true;
      })()`)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) }, sessionId)
      await delay(60)
      // 先在画布内移动过阈值完成 claim（触屏是延迟 claim：按下只记候选，移动才进入瞄准）。
      // **等状态而不是等时钟**：Chrome 的触屏 pointermove 按帧合并派发，CI 无 GPU 渲染慢时
      // 固定 delay 会读到「事件还没送到」的中间态（18872f5c 与 67f3a01a 两次 CI 失败均源于此）。
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + 24, from.y) }, sessionId)
      const claimed = await page.waitForValue('window.__armorRicochet.aimingState().aiming', (v) => v === true,
        { timeout: 5000, label: 'touch aim claim' }).then(() => true).catch(() => false)
      check(claimed, `画布内移动过阈值即 claim 瞄准（aiming=${claimed}）`)
      if (!claimed) {
        console.log(`[armor-aiming] 事件序列: ${JSON.stringify(await page.evaluate('window.__ev'))}`)
        console.log(`[armor-aiming] 会话态: ${JSON.stringify((await page.evaluate('window.__armorRicochet.aimingState()')).session)}`)
      }
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
