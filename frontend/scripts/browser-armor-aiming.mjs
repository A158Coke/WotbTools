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
import { FIXTURE_TANK_ID, FIXTURE_TURRETLESS_TANK_ID, startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'
// 判定触发面（Primary = 主装甲板）与产品同源：射线未触达 Primary 的点击不构成判定
//（BlitzKit 的 shoot() 只挂在 Primary 网格上）。门禁断言依赖这份分类，勿在脚本里另抄一份。
import { ArmorSection, isPrimary } from '../src/scene/penetration.js'
import { buildFindSpotsExpr } from './armor-spot-scan.mjs'

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
  // 部位采样必须实际命中 canvas，并同时满足可视化第一命中名（__raytrace 的报告面）与**产品同一分类器**
  // __aimPart 的结论一致——只按名字采样会在视觉模型/装甲模型命中顺序不一致时取到
  // "看着是炮塔、按下却落进车体/相机分支"的像素，让断言在 CI 上随机翻车。
  // 选择逻辑（首选主装甲 / 次选仅间隙甲+外部模块 / 首选齐备即早退）见 armor-spot-scan.mjs，
  // 由 armor-spot-scan.test.mjs 确定性锁定（含"次选先出现不得占位"的回归用例）。
  // need 可裁剪（触屏视口窄，转动后炮管可能出画/被遮挡时只要求用得到的部位）
  const findSpotsExpr = (need) => buildFindSpotsExpr({ need, primarySections: PRIMARY_SECTIONS })
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

  // 遮挡回归：几何射线仍命中炮塔，但 DOM 顶层已是按钮；扫描必须换到可交互的 canvas 像素。
  // 只在夹具页临时加覆盖控件，不隐藏真实面板、不改变相机/模型，也不向按钮派发手势。
  const occlusion = await page.evaluate(`(() => {
    const c = document.querySelector('canvas');
    const button = document.createElement('button');
    button.textContent = 'fixture overlay';
    button.style.cssText = 'position:fixed;left:${spots.turret.x - 8}px;top:${spots.turret.y - 8}px;width:16px;height:16px;padding:0;z-index:2147483647';
    document.body.append(button);
    try {
      const covered = document.elementFromPoint(${spots.turret.x}, ${spots.turret.y}) === button;
      const next = ${findSpotsExpr(['turret'])};
      return {
        covered,
        canvasHit: !!next.turret && document.elementFromPoint(next.turret.x, next.turret.y) === c,
        next: next.turret,
      };
    } finally { button.remove(); }
  })()`)
  check(occlusion.covered && occlusion.canvasHit,
    `遮挡回归：按钮截获旧炮塔坐标，重新扫描仍命中画布（${JSON.stringify(occlusion)}）`)

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
    for (let cy = Math.round(c.height * 0.05); cy < Math.round(c.height * 0.95); cy += 6) {
      for (let cx = Math.round(c.width * 0.05); cx < Math.round(c.width * 0.95); cx += 6) {
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

  for (const part of ['turret', 'hull']) {
    const sample = spots[part]
    const roi = await page.evaluate(`window.__armorRicochet.readPixels(${JSON.stringify({ x: sample.x, y: sample.y, width: 3, height: 3 })})`)
    check(roi?.pixels.length > 0 && roi.identities.length > 0, '原始 ID / 分类通道可读回连续像素')
    check(roi?.pixels.every(p => Number.isInteger(p.id) && Number.isInteger(p.triangleId) && [0, 1, 2].includes(p.cls)),
      '原始身份/分类不受透明混色或 MSAA 污染')
    const repeat = await page.evaluate(`window.__armorRicochet.readPixels(${JSON.stringify({ x: sample.x, y: sample.y, width: 3, height: 3 })})`)
    check(JSON.stringify(roi?.pixels) === JSON.stringify(repeat?.pixels), '同姿态连续读回身份/分类/CPU 层链稳定')
    const reflected = roi?.pixels.filter(p => p.cpu && !p.cpu.skip) || []
    if (part === 'hull' && !useRealAssets) check(reflected.length > 0, '夹具斜车体提供非零跳弹对照样本')
    if (reflected.length) check(reflected.every(p => p.cls === p.cpu.cls), `跳弹采样 GPU 与同输入 CPU 一致（${reflected.length} 个）`)
    else console.log(`[armor-aiming] ${part} ROI 无跳弹样本，仅验证身份/重复读回`)
    check(reflected.every(p => p.triangleId === p.cpu.detail.first.triangleId), 'GPU/CPU 三角形编号使用同一网格局部索引')
  }

  if (!useRealAssets) {
    // __DBG__ 在初始化时先于异步 armour model 建立；等非 null 再缩放，避免把
    // “hook 尚未挂上”误报成坏姿态恢复失败。
    await page.waitForValue('!!window.__DBG__?.armorModel', (v) => v === true,
      { label: 'debug armor model', timeout: 30000 })
    const retry = await page.evaluate(`(() => {
      const h=window.__armorRicochet, model=window.__DBG__.armorModel;
      const scale=model.scale.clone(), before=h.info();
      let failed;
      try {
        model.scale.setScalar(1000); // real oversized geometry failure, no mocked dirty flag
        for(let i=0;i<240;i++) h.predict(-1,-1);
        failed=h.info();
      } finally { model.scale.copy(scale); }
      h.predict(-1,-1); // return to the exact last successful pose A
      return {before,failed,recovered:h.info()};
    })()`)
    check(!retry.failed.enabled && !retry.failed.grid && !retry.failed.poseDirty,
      '坏姿态 B 耗尽重试后统一关闭续飞')
    check(retry.recovered.enabled && retry.recovered.poseMatchesGrid && retry.recovered.gridGeneration > retry.before.gridGeneration,
      'B → 原成功姿态 A 无手动 dirty 标记也重新建立网格')
  }

  // Execute the production GLSL with gun_mask clipping. The module/primary are
  // coincident at z=0; the clip plane hides the 50mm gunBarrel, so only the
  // 70mm turret plate remains and remIn=100 must penetrate.
  const clipCase = await page.evaluate(`(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { buildPack, buildRicochetGrid, createGridTextures, RC_GLSL_CONST, RC_GLSL_FUNCS } =
      await import('/src/scene/armorCollisionPack.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(1, 1);
    const target = new T.WebGLRenderTarget(1, 1);
    const geometry = new T.PlaneGeometry(2, 2);
    const sourceMaterial = new T.MeshBasicMaterial();
    const module = new T.Mesh(geometry, sourceMaterial);
    const primary = new T.Mesh(geometry, sourceMaterial);
    const pack = buildPack([
      { section: 'gunBarrel', mesh: module, thickness: 50 },
      { section: 'turret', mesh: primary, thickness: 70 },
    ]);
    const grid = buildRicochetGrid(pack), tex = createGridTextures(grid);
    const material = new T.ShaderMaterial({
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: 'precision highp float; uniform float caliber; uniform float normalization; uniform float ricochet; uniform float remIn;\\n' + RC_GLSL_CONST + RC_GLSL_FUNCS +
        'void main(){float p;float d;int c=rcContinue(vec3(0.13,0.17,1.0),vec3(0.0,0.0,-1.0),remIn,p,d);gl_FragColor=vec4(float(c)/255.0,d/255.0,p,1.0);}',
      uniforms: { caliber:{value:120}, normalization:{value:5 * Math.PI / 180}, remIn:{value:100}, rcThickMul:{value:1}, ricochet:{value:70 * Math.PI / 180},
        rcClipEnabled:{value:1}, rcClipPlane:{value:new T.Vector4(0,0,-1,-0.5)},
        rcWorldTris:{value:tex.worldTrisTex},rcGridCells:{value:tex.cellsTex},rcGridEntries:{value:tex.entriesTex},
        rcGridMin:{value:new T.Vector3(...grid.gridMin)},rcGridDimsF:{value:new T.Vector3(...grid.dims)},rcCell:{value:grid.cellSize} }
    });
    try {
      const scene = new T.Scene(); scene.add(new T.Mesh(geometry,material));
      renderer.setRenderTarget(target); renderer.render(scene,new T.Camera());
      const pixel = new Uint8Array(4); renderer.readRenderTargetPixels(target,0,0,1,1,pixel);
      return { cls: pixel[0], diag: pixel[1] };
    } finally {
      material.dispose(); Object.values(tex).forEach(t=>t.dispose());
      target.dispose(); geometry.dispose(); sourceMaterial.dispose();
      renderer.dispose(); renderer.forceContextLoss();
    }
  })()`)
  check(clipCase.cls === 1 && clipCase.diag === 1,
    `gun_mask 负侧炮管被 rcContinue 剔除，只剩炮盾必穿：${JSON.stringify(clipCase)}`)

  // 第二次跳弹（production GLSL）：续飞段 80° 跳弹 → 炮弹消失，无最终结论。
  const bounceCase = await page.evaluate(`(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { buildPack, buildRicochetGrid, createGridTextures, RC_GLSL_CONST, RC_GLSL_FUNCS } =
      await import('/src/scene/armorCollisionPack.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(1, 1);
    const target = new T.WebGLRenderTarget(1, 1);
    const geometry = new T.PlaneGeometry(2, 2);
    const sourceMaterial = new T.MeshBasicMaterial();
    const first = new T.Mesh(geometry, sourceMaterial);
    first.rotation.y = -10 * Math.PI / 180; first.updateMatrix();
    const pack = buildPack([
      { section: 'turret', mesh: first, thickness: 50 },
    ]);
    const grid = buildRicochetGrid(pack), tex = createGridTextures(grid);
    const material = new T.ShaderMaterial({
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: 'precision highp float; uniform float caliber; uniform float normalization; uniform float ricochet; uniform float remIn;\\n' + RC_GLSL_CONST + RC_GLSL_FUNCS +
        'void main(){float p;float d;int c=rcContinue(vec3(-2.0,0.0,0.0),vec3(1.0,0.0,0.0),remIn,p,d);gl_FragColor=vec4(float(c)/255.0,d/255.0,p,1.0);}',
      uniforms: { caliber:{value:120}, normalization:{value:0}, ricochet:{value:70 * Math.PI / 180}, remIn:{value:100}, rcThickMul:{value:1},
        rcClipEnabled:{value:0}, rcClipPlane:{value:new T.Vector4()},
        rcWorldTris:{value:tex.worldTrisTex},rcGridCells:{value:tex.cellsTex},rcGridEntries:{value:tex.entriesTex},
        rcGridMin:{value:new T.Vector3(...grid.gridMin)},rcGridDimsF:{value:new T.Vector3(...grid.dims)},rcCell:{value:grid.cellSize} }
    });
    try {
      const scene = new T.Scene(); scene.add(new T.Mesh(geometry,material));
      renderer.setRenderTarget(target); renderer.render(scene,new T.Camera());
      const pixel = new Uint8Array(4); renderer.readRenderTargetPixels(target,0,0,1,1,pixel);
      return { cls: pixel[0], diag: pixel[1] };
    } finally {
      material.dispose(); Object.values(tex).forEach(t=>t.dispose());
      target.dispose(); geometry.dispose(); sourceMaterial.dispose();
      renderer.dispose(); renderer.forceContextLoss();
    }
  })()`)
  check(bounceCase.cls === 0 && bounceCase.diag === 0,
    `续飞段再次跳弹（第二次）→ 炮弹消失/无最终结论：${JSON.stringify(bounceCase)}`)
  // 续飞首层是间隙甲时同样必须执行第二次跳弹判定（production GLSL）。
  const spacedBounceCase = await page.evaluate(`(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { buildPack, buildRicochetGrid, createGridTextures, RC_GLSL_CONST, RC_GLSL_FUNCS } =
      await import('/src/scene/armorCollisionPack.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(1, 1);
    const target = new T.WebGLRenderTarget(1, 1);
    const geometry = new T.PlaneGeometry(2, 2);
    const sourceMaterial = new T.MeshBasicMaterial();
    const first = new T.Mesh(geometry, sourceMaterial);
    first.rotation.y = -10 * Math.PI / 180; first.updateMatrix();
    const pack = buildPack([{ section: 'spaced', mesh: first, thickness: 50 }]);
    const grid = buildRicochetGrid(pack), tex = createGridTextures(grid);
    const material = new T.ShaderMaterial({
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: 'precision highp float; uniform float caliber; uniform float normalization; uniform float ricochet; uniform float remIn;\\n' + RC_GLSL_CONST + RC_GLSL_FUNCS +
        'void main(){float p;float d;int c=rcContinue(vec3(-2.0,0.0,0.0),vec3(1.0,0.0,0.0),remIn,p,d);gl_FragColor=vec4(float(c)/255.0,d/255.0,p,1.0);}',
      uniforms: { caliber:{value:120}, normalization:{value:0}, ricochet:{value:70 * Math.PI / 180}, remIn:{value:100}, rcThickMul:{value:1},
        rcClipEnabled:{value:0}, rcClipPlane:{value:new T.Vector4()},
        rcWorldTris:{value:tex.worldTrisTex},rcGridCells:{value:tex.cellsTex},rcGridEntries:{value:tex.entriesTex},
        rcGridMin:{value:new T.Vector3(...grid.gridMin)},rcGridDimsF:{value:new T.Vector3(...grid.dims)},rcCell:{value:grid.cellSize} }
    });
    try {
      const scene = new T.Scene(); scene.add(new T.Mesh(geometry,material));
      renderer.setRenderTarget(target); renderer.render(scene,new T.Camera());
      const pixel = new Uint8Array(4); renderer.readRenderTargetPixels(target,0,0,1,1,pixel);
      return { cls: pixel[0], diag: pixel[1] };
    } finally {
      material.dispose(); Object.values(tex).forEach(t=>t.dispose());
      target.dispose(); geometry.dispose(); sourceMaterial.dispose();
      renderer.dispose(); renderer.forceContextLoss();
    }
  })()`)
  check(spacedBounceCase.cls === 0 && spacedBounceCase.diag === 0,
    `续飞首层间隙甲跳弹（第二次）→ 炮弹消失/无最终结论：${JSON.stringify(spacedBounceCase)}`)

  const zeroPlateCase = await page.evaluate(`(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { buildPack, buildRicochetGrid, createGridTextures, RC_GLSL_CONST, RC_GLSL_FUNCS } =
      await import('/src/scene/armorCollisionPack.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(1, 1);
    const target = new T.WebGLRenderTarget(1, 1);
    const geometry = new T.PlaneGeometry(2, 2);
    const sourceMaterial = new T.MeshBasicMaterial();
    const first = new T.Mesh(geometry, sourceMaterial);
    first.rotation.y = -10 * Math.PI / 180; first.updateMatrix();
    const pack = buildPack([
      { section: 'turret', mesh: first, thickness: 0 },
    ]);
    const grid = buildRicochetGrid(pack), tex = createGridTextures(grid);
    const material = new T.ShaderMaterial({
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: 'precision highp float; uniform float caliber; uniform float normalization; uniform float ricochet; uniform float remIn;\\n' + RC_GLSL_CONST + RC_GLSL_FUNCS +
        'void main(){float p;float d;int c=rcContinue(vec3(-2.0,0.0,0.0),vec3(1.0,0.0,0.0),remIn,p,d);gl_FragColor=vec4(float(c)/255.0,d/255.0,p,1.0);}',
      uniforms: { caliber:{value:120}, normalization:{value:0}, ricochet:{value:70 * Math.PI / 180}, remIn:{value:100}, rcThickMul:{value:1},
        rcClipEnabled:{value:0}, rcClipPlane:{value:new T.Vector4()},
        rcWorldTris:{value:tex.worldTrisTex},rcGridCells:{value:tex.cellsTex},rcGridEntries:{value:tex.entriesTex},
        rcGridMin:{value:new T.Vector3(...grid.gridMin)},rcGridDimsF:{value:new T.Vector3(...grid.dims)},rcCell:{value:grid.cellSize} }
    });
    try {
      const scene = new T.Scene(); scene.add(new T.Mesh(geometry,material));
      renderer.setRenderTarget(target); renderer.render(scene,new T.Camera());
      const pixel = new Uint8Array(4); renderer.readRenderTargetPixels(target,0,0,1,1,pixel);
      return { cls: pixel[0], diag: pixel[1] };
    } finally {
      material.dispose(); Object.values(tex).forEach(t=>t.dispose());
      target.dispose(); geometry.dispose(); sourceMaterial.dispose();
      renderer.dispose(); renderer.forceContextLoss();
    }
  })()`)
  check(zeroPlateCase.cls === 1 && zeroPlateCase.diag === 1,
    `续飞命中 0mm 主装甲按 3× 口径 overmatch 击穿，不判跳弹：${JSON.stringify(zeroPlateCase)}`)

  // #711: sub-threshold movement remains a click and must not rotate the model or rebuild its grid.
  for (const part of ['turret', 'gun']) {
    const point = (await findSpots())[part]
    const before = await page.evaluate('({ info: window.__armorRicochet.info(), pose: window.__armorRicochet.aimingState() })')
    await mouseDrag(point, 3, 1)
    const after = await page.evaluate('({ info: window.__armorRicochet.info(), pose: window.__armorRicochet.aimingState() })')
    check(after.pose.turretDeg === before.pose.turretDeg && after.pose.gunDeg === before.pose.gunDeg,
      `微动·${part} 不改变精确姿态`)
    check(after.info.judgments === before.info.judgments + 1, `微动·${part} 仍为单次点击`)
    check(after.info.gridGeneration === before.info.gridGeneration && after.info.poseMatchesGrid,
      `微动·${part} 复用同一碰撞网格`)
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
    check(await page.evaluate('window.__armorRicochet.info().poseMatchesGrid'), '拖动后所有通道使用当前姿态网格')
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

  // —— 结果卡随画布滚动（真实布局，替代纯源码正则守卫）——
  // #traj-info 是 position:fixed；页面滚动后 left/top 必须按 canvas 的实时 rect 重算。
  //
  // 同步契约（2026-10-19）：这个 scroll-layout 用例真正需要的不变量是「卡片锚定在画布上」，
  // 不是「卡片绝对屏幕坐标连续 5 帧不动」。旧实现把后者当成相机停止的判据，等于要求
  // OrbitControls damping（每帧只衰减 5%）在慢 runner（~2fps 时 45s 仅 ~90 帧）内收敛到
  // 亚像素；按 0.95^n 计算需要 135+ 帧，所以它必然随帧率翻车——是测试同步错误，不是产品 bug。
  // 新同步链（全部等状态，不吞超时、不新增固定 delay）：
  //   1) 前一个 hull drag 的指针会话释放（aiming=false / controls enabled）；
  //   2) 用 animate 每帧同一个 controls.update() 把余滑快进到收敛（400 次后残量 0.95^400），
  //      相机到达与自然收敛完全一致的静止位姿，只是不再等慢 runner 的真实帧；
  //   3) 等产品自己的静止状态 cameraSettledMs > max(400, 3×frameIntervalMs)；
  //   4) 等「卡片相对画布」的锚点连续 3 帧稳定，这才是不变量；
  //   5) 滚动后先等画布 rect 移动，再等卡片重新锚定回同一相对偏移，最后对比 delta。
  {
    await page.waitForValue(`(() => {
      const s = window.__armorRicochet.aimingState();
      return s.aiming === false && s.controlsEnabled === true;
    })()`, (v) => v === true, { timeout: 10000, label: 'aiming released before scroll test' })

    // 快进 damping：与 animate 每帧调用的是同一个 OrbitControls.update()，400 帧后
    // 余滑 = 0.95^400 ≈ 1e-9，相机位姿与自然收敛一致；不修改产品配置（damping 仍为开）。
    await page.waitForValue('!!window.__DBG__?.controls', (v) => v === true,
      { timeout: 10000, label: 'controls debug handle' })
    const flushed = await page.evaluate(`(() => {
      const controls = window.__DBG__.controls;
      for (let i = 0; i < 400; i++) controls.update();
      return true;
    })()`).catch((error) => ({ error: error.message }))
    if (flushed !== true) throw new Error(`camera damping flush failed (${JSON.stringify(flushed)})`)

    // 先让下一帧观测到这次跳跃（trackCameraMotion 复位 cameraMovedAt），再等产品静止状态。
    await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
    await page.waitForValue(`(() => {
      const s = window.__armorRicochet.aimingState();
      return s.cameraSettledMs > Math.max(400, 3 * s.frameIntervalMs);
    })()`, (v) => v === true, { timeout: 20000, label: 'camera settled before scroll test' })

    // 锚定不变量的就绪门：卡片相对画布的偏移（而不是绝对屏幕坐标）连续 3 帧稳定。
    const anchorReady = await page.evaluate(`new Promise((resolve) => {
      const started = performance.now();
      let prev = null, stableFrames = 0, last = null;
      const tick = () => {
        const card = document.getElementById('traj-info');
        const canvas = document.querySelector('canvas');
        const c = card && card.getBoundingClientRect();
        const v = canvas && canvas.getBoundingClientRect();
        last = c && v && c.width > 0 && c.height > 0
          ? { anchorX: c.x - v.x, anchorY: c.y - v.y, cardW: c.width, cardH: c.height }
          : null;
        if (last) {
          stableFrames = prev && Math.abs(last.anchorX - prev.anchorX) < 0.5
            && Math.abs(last.anchorY - prev.anchorY) < 0.5 ? stableFrames + 1 : 1;
          prev = last;
          if (stableFrames >= 3) { resolve({ ok: true, anchor: last }); return; }
        } else {
          stableFrames = 0;
          prev = null;
        }
        if (performance.now() - started > 15000) { resolve({ ok: false, anchor: last }); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })`)
    if (!anchorReady.ok) {
      throw new Error(`result card never anchored to canvas before scroll test (${JSON.stringify(anchorReady)})`)
    }

    const readRects = () => page.evaluate(`(() => {
      const card = document.getElementById('traj-info');
      const canvas = document.querySelector('canvas');
      const c = card?.getBoundingClientRect();
      const v = canvas?.getBoundingClientRect();
      return c && v ? {
        card: { x: c.x, y: c.y, w: c.width, h: c.height, display: getComputedStyle(card).display },
        canvas: { x: v.x, y: v.y, w: v.width, h: v.height },
        anchor: { x: c.x - v.x, y: c.y - v.y },
        scrollY: window.scrollY,
      } : null;
    })()`)
    const before = await readRects()
    if (!before) throw new Error('result card / canvas rect missing before scroll test')
    await page.evaluate(`(() => {
      const d = document.createElement('div');
      d.id = 'scroll-fixture';
      d.style.height = '500px';
      // 追加到正文末尾：滚动让画布整体上移，卡片目标点仍留在视口内（不触发
      // 底部钳制），才能断言卡片按 canvas rect 同步位移而不是停在旧位置。
      document.body.append(d);
      window.scrollTo(0, 120);
    })()`)
    // 画布真的因滚动移动（状态等待，不用固定 delay）。
    await page.waitForValue(`(() => {
      const v = document.querySelector('canvas')?.getBoundingClientRect();
      return v ? v.y : null;
    })()`, (v) => Number.isFinite(v) && Math.abs(v - before.canvas.y) > 20,
    { timeout: 5000, label: 'canvas moved by scroll' })
    // 卡片按新的画布 rect 重摆位：相对画布的锚点回到滚动前的值（产品契约）。
    await page.waitForValue(`(() => {
      const card = document.getElementById('traj-info');
      const canvas = document.querySelector('canvas');
      const c = card?.getBoundingClientRect();
      const v = canvas?.getBoundingClientRect();
      return c && v ? { x: c.x - v.x, y: c.y - v.y } : null;
    })()`, (a) => !!a && Math.abs(a.x - before.anchor.x) < 1.5 && Math.abs(a.y - before.anchor.y) < 1.5,
    { timeout: 5000, label: 'result card re-anchored after scroll' })
    const after = await readRects()
    const movedCanvas = before && after && Math.abs(after.canvas.y - before.canvas.y) > 20
    const sameDelta = before && after
      && Math.abs((after.card.x - before.card.x) - (after.canvas.x - before.canvas.x)) < 2.5
      && Math.abs((after.card.y - before.card.y) - (after.canvas.y - before.canvas.y)) < 2.5
    check(movedCanvas, `结果卡锚定门禁：滚动夹具确实移动了画布（${JSON.stringify({ before, after })}）`)
    check(sameDelta, `结果卡随画布滚动（fixed 卡按 canvas rect 重算；${JSON.stringify({ before, after })}）`)
    await page.evaluate(`(() => {
      document.getElementById('scroll-fixture')?.remove();
      window.scrollTo(0, 0);
    })()`)
    // 布局恢复原状后再进入下一个用例（替代原来的固定 delay）。
    await page.waitForValue(`(() => {
      const v = document.querySelector('canvas')?.getBoundingClientRect();
      return v ? v.y : null;
    })()`, (v) => Number.isFinite(v) && Math.abs(v - before.canvas.y) < 1,
    { timeout: 5000, label: 'canvas restored after scroll fixture' })
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
    // 车体按压/画布外 capture 用例不依赖 pinch 状态。慢 runner 上 pinch 后的 damping
    // 可能持续数秒（CI 曾因相机仍在滑行而扫不到 turret），这里重置到初始静态机位再采样。
    await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${TANK}&shell=0&heatmap=1${cameraQuery}&assets=${assets}`)
    await page.waitFor(() => window.__armorRicochet?.info?.()?.meshCount > 0, { timeout: 30000, label: 'reset armor model' })
    await delay(500)
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

  // —— 概率结果卡（真实点击 → 渲染标题 / 颜色 / 伤害）——
  // 放在所有指针/触屏用例之后：本段会重载页面并转动炮塔，避免影响前面的交互断言。
  // 源级守卫只能证明文本存在；这里用真实短按读 DOM：200mm AP 打炮塔（必穿）、
  // 炮管+炮盾（0%）、以及转动炮塔到 200mm 穿深 ±5% 概率带内的中间区间（1–99%）。
  // 夹具模式专用：真实资产覆盖下装甲/弹道参数不同，无法构造固定概率区间。
  if (useRealAssets) {
    console.log('[armor-aiming] 跳过（模式条件）：真实资产覆盖不保证可构造固定概率区间的目标')
  } else {
    await page.emulate({ width: 1400, height: 900, touch: false, deviceScaleFactor: 1 })
    await delay(300)
    await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${TANK}&shell=0&heatmap=1&config=0&az=0&h=2.4&dist=9&assets=${assets}`)
    await page.waitFor(() => window.__armorRicochet?.info?.()?.meshCount > 0,
      { timeout: 30000, label: 'probability card armor model' })
    await delay(500)
    // 判定结果由动态 import 的 judgePenetration() promise 异步写回 #traj-info；
    // 固定 delay 在慢 runner 上会读到上一张卡。用 MutationObserver 等本次渲染。
    await page.waitFor(() => !!document.getElementById('traj-info'),
      { timeout: 5000, label: 'traj-info element' })
    await page.evaluate(`(() => {
      const el = document.getElementById('traj-info');
      window.__probCardRenders = 0;
      new MutationObserver(() => { window.__probCardRenders++ })
        .observe(el, { childList: true, subtree: true, characterData: true });
    })()`)
    const readResultCard = () => page.evaluate(`(() => {
      const el = document.getElementById('traj-info');
      if (!el || el.style.display === 'none') return null;
      const title = [...el.querySelectorAll('div')]
        .find(d => /font-size:18px/.test(d.getAttribute('style') || ''));
      const dot = [...el.querySelectorAll('span')]
        .find(s => (s.textContent || '').includes('●'));
      const probe = (name) => {
        const s = document.createElement('span');
        s.style.color = 'var(' + name + ')';
        el.append(s);
        const c = getComputedStyle(s).color;
        s.remove();
        return c;
      };
      return {
        text: (el.textContent || '').replace(/\\s+/g, ' ').trim(),
        title: (title?.textContent || '').replace(/\\s+/g, ' ').trim(),
        titleColor: title ? getComputedStyle(title).color : null,
        dotColor: dot ? getComputedStyle(dot).color : null,
        green: probe('--green'),
        yellow: probe('--yellow'),
        red: probe('--red'),
      };
    })()`)
    const tapReadCard = async (point) => {
      const before = await page.evaluate('window.__probCardRenders')
      await mouseTap(point)
      const updated = await page.waitForValue('window.__probCardRenders', (v) => v > before,
        { timeout: 5000, label: 'probability result card render' }).then(() => true).catch(() => false)
      return updated ? readResultCard() : null
    }

    const cardSpots = await findSpots(['gun', 'turret'])
    const turretCard = cardSpots.turret ? await tapReadCard(cardSpots.turret) : null
    check(!!turretCard && turretCard.title.startsWith('击穿') && turretCard.text.includes('320')
        && /击穿概率[:：]?\s*100%/.test(turretCard.text),
      `概率卡·必穿：炮塔短按显示“击穿”、100% 概率与全额伤害（${turretCard?.text || '无卡片'}）`)
    check(!!turretCard && turretCard.titleColor === turretCard.green && turretCard.dotColor === turretCard.green,
      `概率卡·必穿：标题/层点为绿色（${turretCard?.titleColor}/${turretCard?.dotColor}）`)

    const gunCard = cardSpots.gun ? await tapReadCard(cardSpots.gun) : null
    check(!!gunCard && gunCard.title.startsWith('未击穿') && !gunCard.text.includes('320')
        && /击穿概率[:：]?\s*0%/.test(gunCard.text),
      `概率卡·0%：炮管+炮盾短按显示“未击穿”、0% 概率且无伤害（${gunCard?.text || '无卡片'}）`)
    check(!!gunCard && /未击穿\s*·\s*0/.test(gunCard.text),
      `概率卡·0%：判定结果右侧仍显示伤害 0（${gunCard?.text || '无卡片'}）`)
    check(!!gunCard && gunCard.titleColor === gunCard.red,
      `概率卡·0%：标题为红色（${gunCard?.titleColor}）`)

    // 转动炮塔让 150mm 首上进入 190–210mm 等效区间（200mm AP ±5% 概率带），
    // 逐步扫描到“可能击穿 1–99%”；真实点击 + 真实概率链，不用源级断言代替渲染。
    let partial = null
    for (let step = 0; step < 14 && !partial; step++) {
      const spotsNow = await findSpots(['turret'])
      if (!spotsNow.turret) break
      const card = await tapReadCard(spotsNow.turret)
      const m = card && /击穿概率[:：]?\s*(>99|<1|\d+(?:\.\d+)?)%/.exec(card.text)
      if (card && card.title.startsWith('可能击穿') && m && m[1] !== '>99' && Number(m[1]) > 0 && Number(m[1]) < 100) {
        partial = { card, pct: Number(m[1]) }
        break
      }
      await mouseDrag(spotsNow.turret, 32, 0)
    }
    check(!!partial, `概率卡·中间区间：真实点击出现“可能击穿 1–99%”（${partial?.card?.text || '未找到'}）`)
    if (partial) {
      check(partial.card.titleColor === partial.card.yellow && partial.card.dotColor === partial.card.yellow,
        `概率卡·中间区间：标题/层点为黄色（${partial.card.titleColor}/${partial.card.dotColor}）`)
      check(partial.card.text.includes('320'),
        `概率卡·中间区间：非零概率仍显示全额伤害（${partial.card.text}）`)
      check(!/击穿概率[:：]?\s*100%/.test(partial.card.text),
        `概率卡·中间区间：不确定概率不得显示 100%（${partial.card.text}）`)
    }
  }

  // —— 固定战斗室（GLB 无 turret_NN）：拖炮管必须真的驱动视觉/装甲矩阵 ——
  // 此前的盲区：aimFromDrag 先写 #turret-val/#gun-val，即使 updateTurretGun 因
  // collectTurretGunNodes 早退而完全没摆位，UI 数字仍会变——只读角度抓不到这个 bug。
  // 这里读 rigState() 的真实 matrix，并且夹具没有任何 turret 节点。
  if (!useRealAssets) {
    let turretlessPack = null
    try {
      turretlessPack = await startFixtureAssetPack({
        variant: 'turretless',
        tankCache: {
          [FIXTURE_TURRETLESS_TANK_ID]: {
            id: FIXTURE_TURRETLESS_TANK_ID, name: 'Fixture Casemate TD',
            tier: 8, nation: 'ussr', type: 'AT-SPG',
          },
        },
      })
      await page.emulate({ width: 1400, height: 900, touch: false, deviceScaleFactor: 1 })
      await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TURRETLESS_TANK_ID}&shell=0&heatmap=0&az=35&h=2.4&dist=9&assets=${turretlessPack.origin}`)
      const rigReady = await page.waitFor(() => {
        const r = window.__armorRicochet?.rigState?.()
        return !!r && r.turret === null && r.guns.length > 0 && r.armorGuns.length > 0
      }, { label: 'turretless rig', timeout: 30000 }).then(() => true).catch(() => false)
      check(rigReady, '固定战斗室：无 turret 节点、炮管组与炮管装甲板均建立姿态表')
      if (!rigReady) throw new Error('turretless rig never became ready')
      await delay(500)
      const rig0 = await page.evaluate('window.__armorRicochet.rigState()')
      const aim0 = await readAim()
      const tdSpots = await findSpots(['gun', 'hull'])
      check(!!tdSpots.gun, `固定战斗室：找到炮管像素（${tdSpots.gun?.name || '无'}）`)
      if (tdSpots.gun) {
        await mouseDrag(tdSpots.gun, 150, 60)
        const rig1 = await page.evaluate('window.__armorRicochet.rigState()')
        const aim1 = await readAim()
        check(JSON.stringify(rig0.guns[0].matrix) !== JSON.stringify(rig1.guns[0].matrix),
          '固定战斗室：拖炮管真的改变视觉炮管矩阵（不只 UI 角度）')
        check(JSON.stringify(rig0.armorGuns[0].matrix) !== JSON.stringify(rig1.armorGuns[0].matrix),
          '固定战斗室：拖炮管真的改变炮管装甲板矩阵')
        check(aim1.t !== aim0.t && aim1.g !== aim0.g,
          `固定战斗室：炮管拖动 = yaw+俯仰（${aim0.t}/${aim0.g} → ${aim1.t}/${aim1.g}）`)
        check(Math.abs(parseFloat(aim1.t)) <= 10.5,
          `固定战斗室：yaw 受 yaw_limits ±10° 限制（${aim1.t}）`)
      }
    } finally {
      if (turretlessPack) await turretlessPack.close()
    }
  } else {
    console.log('[armor-aiming] 跳过（模式条件）：真实资产覆盖不做固定战斗室夹具回归')
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
