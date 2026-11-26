import { readFileSync } from 'node:fs'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { FIXTURE_TANK_DATA, FIXTURE_TANK_ID, FIXTURE_TURRETLESS_TANK_ID, startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'
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
      '--enable-unsafe-swiftshader',
    ],
  })
  const { targetId, sessionId } = await chromeCdp.openPage()
  page = new Page(chromeCdp.client, sessionId)
  await page.enable()
  await page.emulate({ width: 1400, height: 900, touch: false, deviceScaleFactor: 1 })

  const cameraQuery = process.env.AIM_CAMERA || '&az=35&h=2.4&dist=9'
  await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${TANK}&shell=0&heatmap=1${cameraQuery}&assets=${assets}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })

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

  const findSpotsExpr = (need) => buildFindSpotsExpr({ need, primarySections: PRIMARY_SECTIONS })
  const findSpots = async (need = ['gun', 'turret', 'hull']) => {
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
  const waitShotPanel = async ({ minJudgments = 0, timeout = 5000 } = {}) => {
    try {
      return await page.waitForValue(`(() => {
        const el = document.getElementById('traj-info');
        const panel = { visible: !!el && el.style.display !== 'none', text: (el && el.textContent || '').slice(0, 60) };
        const info = window.__armorRicochet && window.__armorRicochet.info
          ? window.__armorRicochet.info()
          : null;
        const judgments = info ? info.judgments : 0;
        return panel.visible && panel.text.trim() && judgments >= ${minJudgments} ? panel : null;
      })()`, (value) => value !== null, { timeout, label: 'shot result panel' })
    } catch {
      return shotPanel()
    }
  }

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

  if (useRealAssets) {
    console.log('[armor-aiming] 跳过（模式条件）：真实资产覆盖不保证存在间隙甲屏幕板，'
      + '「仅间隙甲命中」回归由夹具模式（CI 默认，不带 AIM_ASSETS）覆盖')
  } else {
    const spot = await findScreenOnlyPixel()
    if (!spot) {
      check(false, '未找到「仅间隙甲命中」的像素（夹具屏幕板 turret_01_armor_2 / 机位异常）')
    } else {
      const hullBefore = await readJudgments()
      await mouseTap(spots.hull)
      const before = await waitShotPanel({ minJudgments: hullBefore + 1 })
      const hullAfter = await readJudgments()
      check(before.visible === true && before.text.trim().length > 0 && hullAfter === hullBefore + 1,
        `屏幕场景前置：车体短按留下本次在屏结论（judgments ${hullBefore}→${hullAfter}，"${before.text.trim().slice(0, 24)}"）`)
      const n0 = hullAfter
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

  {
    await page.waitForValue(`(() => {
      const s = window.__armorRicochet.aimingState();
      return s.aiming === false && s.controlsEnabled === true;
    })()`, (v) => v === true, { timeout: 10000, label: 'aiming released before scroll test' })

    await page.waitForValue('!!window.__DBG__?.controls', (v) => v === true,
      { timeout: 10000, label: 'controls debug handle' })
    const flushed = await page.evaluate(`(() => {
      const controls = window.__DBG__.controls;
      for (let i = 0; i < 400; i++) controls.update();
      return true;
    })()`).catch((error) => ({ error: error.message }))
    if (flushed !== true) throw new Error(`camera damping flush failed (${JSON.stringify(flushed)})`)

    await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
    await page.waitForValue(`(() => {
      const s = window.__armorRicochet.aimingState();
      return s.cameraSettledMs > Math.max(400, 3 * s.frameIntervalMs);
    })()`, (v) => v === true, { timeout: 20000, label: 'camera settled before scroll test' })

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
    const follow = await page.evaluate(`(() => {
      const card = document.getElementById('traj-info')?.getBoundingClientRect()
      const stage = document.querySelector('[data-testid="armor-stage"]')?.getBoundingClientRect()
      if (!card || !stage) return null
      const panels = ['#corner-tl', '#corner-tr', '#turret-controls', '.armor-back'].map((selector) => {
        const el = document.querySelector(selector)
        if (!el) return null
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') return null
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null
      }).filter(Boolean)
      const inside = card.left >= stage.left - 1 && card.right <= stage.right + 1
        && card.top >= stage.top - 1 && card.bottom <= stage.bottom + 1
      const overlap = panels.filter((p) => card.right > p.left + 0.5 && card.left < p.right - 0.5
        && card.bottom > p.top + 0.5 && card.top < p.bottom - 0.5)
      return {
        inside,
        overlap: overlap.length,
        card: { left: Math.round(card.left), top: Math.round(card.top), right: Math.round(card.right), bottom: Math.round(card.bottom) },
        stage: { left: Math.round(stage.left), top: Math.round(stage.top), right: Math.round(stage.right), bottom: Math.round(stage.bottom) },
      }
    })()`)
    check(!!follow && follow.inside && follow.overlap === 0,
      `结果卡没有跟随点击的几何契约（须完整落在场景内且不压固定 HUD；${JSON.stringify(follow)}）`)
    await page.evaluate(`(() => {
      const d = document.createElement('div');
      d.id = 'scroll-fixture';
      d.style.height = '500px';
      // 追加到正文末尾：滚动让画布整体上移，卡片目标点仍留在视口内（不触发
      // 底部钳制），才能断言卡片按 canvas rect 同步位移而不是停在旧位置。
      document.body.append(d);
      window.scrollTo(0, 120);
    })()`)
    await page.waitForValue(`(() => {
      const v = document.querySelector('canvas')?.getBoundingClientRect();
      return v ? v.y : null;
    })()`, (v) => Number.isFinite(v) && Math.abs(v - before.canvas.y) > 20,
    { timeout: 5000, label: 'canvas moved by scroll' })
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
    await page.waitForValue(`(() => {
      const v = document.querySelector('canvas')?.getBoundingClientRect();
      return v ? v.y : null;
    })()`, (v) => Number.isFinite(v) && Math.abs(v - before.canvas.y) < 1,
    { timeout: 5000, label: 'canvas restored after scroll fixture' })
  }

  await page.emulate({ width: 1400, height: 900, touch: true, deviceScaleFactor: 1 })
  await delay(300)
  {
    const s = await rescan('炮管 pinch 前')
    await pinchZoom('炮管上起手的双指缩放', s.gun, 130, 70)
  }

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
    const s = await findSpots(['turret'])
    if (s.turret) await pinchZoom('触屏·炮塔上起手的双指缩放', s.turret, 90, 60, 'diverge')
    else check(false, '触屏视口下未找到炮塔像素（pinch 用例）')
  }
  {
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

    const from = s.turret
    if (from) {
      const cdp = chromeCdp.client
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
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + 24, from.y) }, sessionId)
      const claimed = await page.waitForValue('window.__armorRicochet.aimingState().aiming', (v) => v === true,
        { timeout: 5000, label: 'touch aim claim' }).then(() => true).catch(() => false)
      check(claimed, `画布内移动过阈值即 claim 瞄准（aiming=${claimed}）`)
      if (!claimed) {
        console.log(`[armor-aiming] 事件序列: ${JSON.stringify(await page.evaluate('window.__ev'))}`)
        console.log(`[armor-aiming] 会话态: ${JSON.stringify((await page.evaluate('window.__armorRicochet.aimingState()')).session)}`)
      }
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

  if (useRealAssets) {
    console.log('[armor-aiming] 跳过（模式条件）：真实资产覆盖不保证可构造固定概率区间的目标')
  } else {
    await page.emulate({ width: 1400, height: 900, touch: false, deviceScaleFactor: 1 })
    await delay(300)
    await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${TANK}&shell=0&heatmap=1&config=0&az=0&h=2.4&dist=9&assets=${assets}`)
    await page.waitFor(() => window.__armorRicochet?.info?.()?.meshCount > 0,
      { timeout: 30000, label: 'probability card armor model' })
    await delay(500)
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

    await page.evaluate(`(() => {
      const card = document.getElementById('traj-info')?.querySelector('div');
      if (!card) return false;
      for (let i = 0; i < 80; i++) {
        const row = document.createElement('div');
        row.dataset.scrollFixture = '1';
        row.textContent = 'fixture layer ' + i + ' — 200mm @ 45°';
        row.style.cssText = 'font-size:12px;line-height:18px;';
        card.append(row);
      }
      window.dispatchEvent(new Event('resize'));
      return true;
    })()`)
    const overflow = await page.waitForValue(`(() => {
      const el = document.getElementById('traj-info');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        pointerEvents: getComputedStyle(el).pointerEvents,
        center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      };
    })()`, (value) => !!value && value.scrollHeight > value.clientHeight + 1 && value.pointerEvents === 'auto',
    { timeout: 5000, label: 'overflow result card accepts pointer events' })
    check(overflow.scrollHeight > overflow.clientHeight + 1 && overflow.pointerEvents === 'auto',
      `溢出结果卡没有恢复指针事件（${JSON.stringify(overflow)}）`)
    await chromeCdp.client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round(overflow.center.x), y: Math.round(overflow.center.y), deltaX: 0, deltaY: 160,
    }, sessionId)
    const scrolledTop = await page.waitForValue('document.getElementById("traj-info").scrollTop',
      (value) => typeof value === 'number' && value > 0, { timeout: 3000, label: 'overflow result card wheel scroll' })
      .catch(() => null)
    check(typeof scrolledTop === 'number' && scrolledTop > 0,
      `溢出结果卡无法用滚轮滚动（scrollTop=${JSON.stringify(scrolledTop)}）`)
    await page.evaluate(`(() => {
      document.querySelectorAll('#traj-info [data-scroll-fixture]').forEach((node) => node.remove());
      window.dispatchEvent(new Event('resize'));
    })()`)
    const restored = await page.waitForValue(`(() => {
      const el = document.getElementById('traj-info');
      return el ? { overflowing: el.scrollHeight > el.clientHeight + 1, pointerEvents: getComputedStyle(el).pointerEvents } : null;
    })()`, (value) => !!value && value.overflowing === false && value.pointerEvents === 'none',
    { timeout: 5000, label: 'result card restores click-through' })
    check(restored.overflowing === false && restored.pointerEvents === 'none',
      `溢出消除后结果卡未恢复点击穿透（${JSON.stringify(restored)}）`)

    {
      const toolsPoint = await page.evaluate(`(() => {
        const r = document.querySelector('[data-testid="armor-tools"]').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`)
      await mouseTap(toolsPoint)
      await page.waitForValue(`getComputedStyle(document.querySelector('#tank-selectors')).display`,
        (value) => value !== 'none', { timeout: 5000, label: 'tools panel expanded' })
      await page.evaluate(`(() => {
        const r = document.getElementById('tank-selectors').getBoundingClientRect();
        window.__expandedToolsRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      })()`)
      await page.evaluate(`document.querySelector('[data-testid="armor-tools-close"]').click()`)
      await page.waitForValue(`getComputedStyle(document.querySelector('#tank-selectors')).display`,
        (value) => value === 'none', { timeout: 5000, label: 'tools panel collapsed' })
      await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      await page.evaluate(`(() => {
        const card = document.getElementById('traj-info');
        const stage = document.querySelector('[data-testid="armor-stage"]');
        const stageRect = stage.getBoundingClientRect();
        const left = window.__expandedToolsRect.left - stageRect.left + 24;
        const top = window.__expandedToolsRect.top - stageRect.top + 24;
        card.style.insetInlineStart = left + 'px';
        card.style.insetBlockStart = top + 'px';
        card.style.left = left + 'px';
        card.style.top = top + 'px';
        card.style.transform = 'none';
      })()`)
      await mouseTap(toolsPoint)
      const avoided = await page.waitForValue(`(() => {
        const card = document.getElementById('traj-info');
        const panel = document.getElementById('corner-tl');
        const stage = document.querySelector('[data-testid="armor-stage"]');
        const c = card.getBoundingClientRect(), p = panel.getBoundingClientRect(), s = stage.getBoundingClientRect();
        const expanded = getComputedStyle(document.querySelector('#tank-selectors')).display !== 'none';
        const overlap = c.right > p.left + 0.5 && c.left < p.right - 0.5 && c.bottom > p.top + 0.5 && c.top < p.bottom - 0.5;
        const inside = c.left >= s.left - 1 && c.right <= s.right + 1 && c.top >= s.top - 1 && c.bottom <= s.bottom + 1;
        return {
          expanded,
          overlap,
          inside,
          card: { left: Math.round(c.left), top: Math.round(c.top) },
          panel: { left: Math.round(p.left), top: Math.round(p.top), right: Math.round(p.right), bottom: Math.round(p.bottom) },
        };
      })()`, (value) => !!value && value.expanded === true && value.overlap === false && value.inside === true,
      { timeout: 5000, label: 'result card avoids expanded tools panel' })
      check(avoided.expanded === true && avoided.overlap === false && avoided.inside === true,
        `结果卡没有避开展开后的参数面板（${JSON.stringify(avoided)}）`)
      await page.evaluate(`document.querySelector('[data-testid="armor-tools-close"]').click()`)
      await page.waitForValue(`getComputedStyle(document.querySelector('#tank-selectors')).display`,
        (value) => value === 'none', { timeout: 5000, label: 'tools panel collapsed after avoidance test' })
    }
  }

  if (!useRealAssets) {
    for (const [camview, pose, yaw, pitch] of [
      ['front', 'yaw=45&pitch=-5', 45, -5],
      ['hull_down', 'yaw=45&pitch=-5', 45, -5],
      ['front', 'yaw=25', 25, 0],
      ['hull_down', 'pitch=-5', 0, -5],
    ]) {
      await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${TANK}&camview=${camview}&${pose}&assets=${assets}`)
      await page.waitForValue('window.__armorRicochet?.aimingState?.()',
        state => state?.turretDeg === yaw && state?.gunDeg === pitch,
        { timeout: 30000, label: `${camview}: explicit URL pose wins` })
      check(true, `${camview}: URL ${pose} 保持 ${yaw}°/${pitch}°`)
    }
    const modules = JSON.parse(readFileSync(new URL('../src/replay-local/compute/__fixtures__/modules/european.json', import.meta.url), 'utf8'))
      .tanks.It21_Controcarro3_Minotauro
    const tiltedData = { ...FIXTURE_TANK_DATA, initial_turret_rotation: modules.initialTurretRotation,
      configs: FIXTURE_TANK_DATA.configs.map(config => ({ ...config, pitch_limits: modules.turrets[0].guns[0].stats.pitchLimits })) }
    const tiltedPack = await startFixtureAssetPack({ extraRoutes: {
      [`/tank/${FIXTURE_TANK_ID}.json`]: { type: 'application/json', body: JSON.stringify(tiltedData) },
    } })
    try {
      await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&assets=${tiltedPack.origin}`)
      await page.waitFor(() => !document.querySelector('[data-testid="armor-camera-front"]')?.disabled
        && !!window.__armorRicochet?.rigState?.().guns.length
        && !!window.__armorRicochet?.rigState?.().pivots?.gun,
        { timeout: 30000, label: 'tilted Minotauro pose fixture ready' })
      for (const [name, local, expectedWorld] of [['hull-down', -7, -10], ['front', 0, -3]]) {
        const point = await page.evaluate(`(() => {
          const r = document.querySelector('[data-testid="armor-camera-${name}"]').getBoundingClientRect();
          return {x:r.x+r.width/2,y:r.y+r.height/2};
        })()`)
        await mouseTap(point)
        await page.waitForValue('window.__armorRicochet.aimingState().gunDeg', value => value === local,
          { timeout: 5000, label: 'preset local gun angle' })
        const world = await page.evaluate(`(() => {
          const c=window.__DBG__.controls;
          const pt=window.__armorRicochet.rigState().presetTarget;
          const wp=new window.__DBG__.THREE.Vector3(pt.x,pt.y,pt.z);
          const d=c.object.position.clone().sub(wp);
          return Math.atan2(d.y, Math.hypot(d.x,d.z))*180/Math.PI;
        })()`)
        check(Math.abs(world - expectedWorld) < .01,
          `Minotauro ${name}: 局部 ${local}°、世界炮线 ${expectedWorld}°（实际 ${world}°）`)
      }
    } finally { await tiltedPack.close() }
  }

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
      const presetPoint = async (name) => page.evaluate(`(() => {
        const b = document.querySelector('[data-testid="armor-camera-${name}"]');
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`)
      await page.waitFor(() => !!window.__armorRicochet?.rigState?.()?.pivots?.gun,
        { timeout: 30000, label: 'turretless gun pivot installed' })
      const orbitBefore = await page.evaluate('(() => { const c = window.__DBG__.controls; return { d: c.object.position.distanceTo(c.target), t: c.target.toArray() } })()')
      await mouseTap(await presetPoint('hull-down'))
      const low = await page.waitForValue('window.__armorRicochet.aimingState()',
        s => s.turretDeg === 0 && s.gunDeg === -20,
        { timeout: 5000, label: 'hull-down preset uses fixture depression' })
      const orbitAfter = await page.evaluate(`(() => {
        const c = window.__DBG__.controls;
        const pt = window.__armorRicochet.rigState().presetTarget;
        const wp = pt ? new window.__DBG__.THREE.Vector3(pt.x, pt.y, pt.z) : null;
        const rel = wp ? c.object.position.clone().sub(wp) : null;
        const elev = rel ? Math.atan2(rel.y, Math.hypot(rel.x, rel.z)) * 180 / Math.PI : null;
        return { d: c.object.position.distanceTo(c.target), t: c.target.toArray(),
                 onAxisElev: elev, axisDist: rel ? rel.length() : null };
      })()`)
      check(orbitAfter.axisDist != null && orbitAfter.axisDist > 0, '压坡卖头预设：pose 暴露炮轴基准点（presetTarget）')
      check(low.controlsEnabled && Math.abs(orbitAfter.d - orbitBefore.d) < 0.01
        && orbitAfter.t.every((v, i) => Math.abs(v - orbitBefore.t[i]) < 1e-6),
        `压坡卖头预设：旋转中心保持默认（${orbitBefore.t.map(v => v.toFixed(2)).join(', ')}）、距离保留（${orbitBefore.d.toFixed(2)}m → ${orbitAfter.d.toFixed(2)}m）`)
      check(orbitAfter.onAxisElev != null && Math.abs(orbitAfter.onAxisElev - (-20)) < 0.01,
        `压坡卖头预设：机位在炮轴线上、炮管正对镜头（相机相对炮线枢轴俯角 ${orbitAfter.onAxisElev?.toFixed(1)}°）`)
      const depressed = await page.evaluate('window.__armorRicochet.rigState()')
      await mouseTap(await presetPoint('front'))
      await page.waitForValue('window.__armorRicochet.aimingState().gunDeg', g => g === 0,
        { timeout: 5000, label: 'front preset levels gun' })
      const level = await page.evaluate('window.__armorRicochet.rigState()')
      check(JSON.stringify(depressed.guns[0].matrix) !== JSON.stringify(level.guns[0].matrix),
        '正面/卖头预设真实改变炮管模型姿态')
      const position = await page.evaluate('window.__DBG__.controls.object.position.toArray()')
      const bounds = await canvasRect()
      await mouseDrag({ x: bounds.right - 80, y: (bounds.top + bounds.bottom) / 2 }, -90, 30)
      await page.waitForValue('window.__DBG__.controls.object.position.toArray()',
        p => p.some((v, i) => Math.abs(v - position[i]) > 0.01),
        { timeout: 5000, label: 'free orbit after preset' })
      check(true, '预设后仍可自由旋转相机')
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
