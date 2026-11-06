/**
 * 间隙甲厚度通道「背面开放板」门禁（真实 GPU readback；review P1，2026-11-06）。
 *
 * 为什么必须是真浏览器 + 真实 GPU：被测行为是 `SPACED_FRAG` 在 `BackSide` clone 上
 * 的入射角/等效厚度——three 对 `side === BackSide` 翻转 `gl.frontFace`，保留的背面
 * 片元在 GL 里是 front-facing（`gl_FrontFacing == true`），必须按 `FLIP_SIDED` 显式
 * 翻回几何法线；否则背面屏入射角变成 π−θ、cos 落 1e-6 下界，20mm 屏被算成 2e7mm。
 * 这是编译后 shader 的像素输出，happy-dom / 正则 / CPU 镜像都无法替代。
 *
 * 确定性：沿用装甲查看器门禁的夹具资产包（进程内 Vite dev server + 构造资产），
 * 门禁自己在页面内建独立 WebGLRenderer + float RT，用**真实模块图**里的
 * `armorShaders.ts` 材质工厂渲染单块 plane，再 readPixels 读 RT0.R：
 *   - 正面屏（FrontSide，正对相机）      → R = 20mm / 200mm = 0.1
 *   - 背面屏（BackSide，绕 Y 转 π）      → R = 0.1   ← 本条回归（修复前 100000）
 *   - BackSide 但正对相机（应被剔除）     → R = 0
 * 任何环境（含 CI 无 GPU，swiftshader 兜底）都真实执行，加载/渲染失败即失败，不 SKIP。
 */
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { FIXTURE_TANK_ID, startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'

const failures = []
const check = (ok, msg) => {
  if (ok) console.log(`[armor-spaced-backside] OK: ${msg}`)
  else { failures.push(msg); console.error(`[armor-spaced-backside] FAIL: ${msg}`) }
}

// 探针参数：20mm 开放板 / 75mm 口径 / 200mm 穿深 / 5° 转正（与 review P1 复现同参数）。
const PROBE = {
  thickness: 20, penetration: 200, caliber: 75, normalizationDeg: 5,
  expectedFront: 0.1, expectedBack: 0.1, expectedCulled: 0,
  tolerance: 1e-3,
}

const chrome = findChrome()
const { server, origin } = await startFixtureServer()
const assetPack = await startFixtureAssetPack()
let chromeCdp = null
let page = null
try {
  chromeCdp = await launchChromeForCdp(chrome, {
    extraArgs: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--enable-unsafe-swiftshader',   // CI 无 GPU：允许软件 WebGL 兜底
    ],
  })
  const { targetId, sessionId } = await chromeCdp.openPage()
  page = new Page(chromeCdp.client, sessionId)
  await page.enable()
  await page.emulate({ width: 1400, height: 900, touch: false, deviceScaleFactor: 1 })

  await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&shell=0&heatmap=1&assets=${assetPack.origin}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })
  const ready = await page.waitFor(() => {
    const h = window.__armorRicochet
    return !!(h && h.info() && h.info().meshCount > 0) && !!window.__DBG__ && !!window.__DBG__.THREE
  }, { label: 'armor model + THREE handle', timeout: 30000 }).catch(() => false)
  check(ready === true, '车模就绪且 __DBG__.THREE 可用（夹具模式：失败即门禁失败，不 SKIP）')
  if (!ready) {
    for (const line of await page.diagnose()) console.error(`[armor-spaced-backside]   ${line}`)
    throw new Error('model never became ready')
  }

  // 页面内探针：真实模块图的 armorShaders.ts + 真实 GPU。
  const result = await page.evaluate(`(async () => {
    const PROBE = ${JSON.stringify(PROBE)};
    // 动态 import 在 CDP evaluate 包装下会被改写，改用原生 module script 加载 dev 模块。
    if (!window.__spacedBacksideShaders) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.type = 'module';
        s.textContent = "import * as m from '/src/scene/viewer/armorShaders.ts'; window.__spacedBacksideShaders = m; window.dispatchEvent(new Event('spaced-backside-module-ready'));";
        s.onerror = () => reject(new Error('module script failed'));
        window.addEventListener('spaced-backside-module-ready', () => resolve(), { once: true });
        document.head.appendChild(s);
      });
    }
    const mod = window.__spacedBacksideShaders;
    const THREE = window.__DBG__.THREE;
    if (!mod || typeof mod.createArmorShaderContext !== 'function') throw new Error('armorShaders module missing createArmorShaderContext');
    const ctx = mod.createArmorShaderContext();
    const W = 32, H = 32;
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(W, H);
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    cam.position.set(0, 0, 3);
    cam.lookAt(0, 0, 0);
    const run = (side, rotateY) => {
      const scene = new THREE.Scene();
      const mat = ctx.spacedMaterial(PROBE.thickness, PROBE.penetration, side);
      mat.uniforms.caliber.value = PROBE.caliber;
      mat.uniforms.normalization.value = PROBE.normalizationDeg * Math.PI / 180;
      const geo = new THREE.PlaneGeometry(2, 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.y = rotateY;
      scene.add(mesh);
      renderer.setRenderTarget(rt);
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(scene, cam);
      const buf = new Float32Array(4);
      renderer.readRenderTargetPixels(rt, W / 2, H / 2, 1, 1, buf);
      mat.dispose(); geo.dispose(); scene.clear();
      return buf[0];
    };
    const out = {
      frontScreen: run(THREE.FrontSide, 0),
      backScreenRotated: run(THREE.BackSide, Math.PI),
      backMatUnrotated: run(THREE.BackSide, 0),
    };
    renderer.dispose();
    return out;
  })()`)

  const near = (a, b) => Math.abs(a - b) <= PROBE.tolerance
  check(near(result.frontScreen, PROBE.expectedFront),
    `正面屏 R = thickness/penetration = ${PROBE.expectedFront}（实际 ${result.frontScreen}）`)
  check(near(result.backScreenRotated, PROBE.expectedBack),
    `背面屏 R = ${PROBE.expectedBack}——FLIP_SIDED 翻回几何法线（实际 ${result.backScreenRotated}；修复前 ≈ ${PROBE.thickness / PROBE.penetration * 1e6}）`)
  check(near(result.backMatUnrotated, PROBE.expectedCulled),
    `BackSide 正对相机被剔除，R = 0（实际 ${result.backMatUnrotated}）`)

  await chromeCdp.client.send('Target.closeTarget', { targetId })
} catch (error) {
  failures.push(`脚本异常：${error.message}`)
  if (page) for (const line of await page.diagnose().catch(() => [])) console.error(`[armor-spaced-backside]   ${line}`)
} finally {
  try { if (chromeCdp?.close) await chromeCdp.close() } catch (_) {}
  if (assetPack) await assetPack.close()
  await server.close()
}

if (failures.length) {
  console.error(`[armor-spaced-backside] ${failures.length} 项失败`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('[armor-spaced-backside] all scenarios passed')