/**
 * 间隙甲厚度通道门禁（真实 GPU readback；review P1 + review P2，2026-11-06）。
 *
 * 不变量全部是**真实装配 + 编译后 shader 的像素输出**，happy-dom / 正则 /
 * CPU 镜像都替代不了（frontend/AGENTS.md Testing rules：source guard 只锁
 * dependency/API ownership）：
 *
 * 1. 同板去重（stencil）：开放壳体（缺一面盒体）经**真实 `populateSpacedArmorScene`**
 *    装配进生产同款 RT0（`stencilBuffer` + `createDepthStencilTexture` + float），
 *    相机正对入射面 → 入射面计 120mm、出射面被 stencil 位抑制，RT0.R = 120/200 = 0.6。
 *    门禁自带**负向对照**：把 back clone 的 stencilFunc 改成 Always（去重失效）重渲染，
 *    必须得到 ≈2× = 1.2 —— 证明 0.6 的断言不是空断言。
 * 2. 穿越顺序无关（review P2）：同键命中序为**近 Back / 远 Front**（反绕序开放壳体，
 *    相机看的是绕序背面）时，front clone 仍先置位 → 只计一次 0.6；同键**只有背面**
 *    （两片背面朝向相机、无入射面）时，back clone 无位可测 → 逐片元累计 2× = 1.2。
 *    点击链 `resolveSpacedHitMask` 用同一判据（整条射线集合、不看先后），CPU/GPU 同层数。
 * 3. 背面开放板法线（FLIP_SIDED）：BackSide clone 渲染的背面屏经真实 shader 编译，
 *    20mm 屏 R = 0.1（修复前 cos 落 1e-6 下界 → 100000）。
 * 4. 对照：闭合盒体（FrontSide 单 clone）R 同为 0.6；BackSide 正对相机被剔除 R=0。
 *
 * 确定性：沿用装甲查看器门禁的夹具资产包（进程内 Vite dev server + 构造资产），
 * 门禁自己在页面内注入 module script 加载**真实模块图**（armorShaders.ts +
 * armorPlateModel.ts），任何环境（含 CI 无 GPU，swiftshader 兜底）都真实执行，
 * 渲染/加载失败即失败，不 SKIP。
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

// 探针参数：20mm/120mm 板 / 75mm 口径 / 200mm 穿深 / 5° 转正（与 review P1 复现同参数）。
const PROBE = {
  thickness: 120, penetration: 200, caliber: 75, normalizationDeg: 5,
  // 开放壳体（真实 populate 装配 + stencil 去重）：入射面 120mm 计一次 → 0.6。
  expectedShellSingle: 0.6,
  // 单 plane 背面屏（FLIP_SIDED）：20mm → 0.1。
  planeThickness: 20, expectedPlane: 0.1,
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

  const result = await page.evaluate(`(async () => {
    const PROBE = ${JSON.stringify(PROBE)};
    // 动态 import 在 CDP evaluate 包装下会被改写，改用原生 module script 加载真实 dev 模块。
    if (!window.__spacedBackside) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.type = 'module';
        s.textContent = "import * as shaders from '/src/scene/viewer/armorShaders.ts'; import * as plate from '/src/scene/viewer/armorPlateModel.ts'; window.__spacedBackside = { shaders, plate }; window.dispatchEvent(new Event('spaced-backside-module-ready'));";
        s.onerror = () => reject(new Error('module script failed'));
        window.addEventListener('spaced-backside-module-ready', () => resolve(), { once: true });
        document.head.appendChild(s);
      });
    }
    const { shaders, plate } = window.__spacedBackside;
    const THREE = window.__DBG__.THREE;
    if (!shaders || typeof shaders.createArmorShaderContext !== 'function') throw new Error('armorShaders module missing createArmorShaderContext');
    if (!plate || typeof plate.populateSpacedArmorScene !== 'function') throw new Error('armorPlateModel module missing populateSpacedArmorScene');
    const ctx = shaders.createArmorShaderContext();
    const W = 32, H = 32;
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(W, H);
    // 生产同款 RT0：stencilBuffer + createDepthStencilTexture + float 颜色。
    const rt = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.FloatType, format: THREE.RGBAFormat,
      depthTexture: shaders.createDepthStencilTexture(W, H), stencilBuffer: true,
    });
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    cam.position.set(0, 0, 3);
    cam.lookAt(0, 0, 0);
    const readR = () => {
      const buf = new Float32Array(4);
      renderer.readRenderTargetPixels(rt, W / 2, H / 2, 1, 1, buf);
      return buf[0];
    };
    const renderSpaced = (scene) => {
      renderer.setRenderTarget(rt);
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(scene, cam);
    };
    // —— 1) 单 plane 材质探针（FLIP_SIDED）——
    const planeMat = (side, thickness) => {
      const mat = ctx.spacedMaterial(thickness, PROBE.penetration, side);
      mat.uniforms.caliber.value = PROBE.caliber;
      mat.uniforms.normalization.value = PROBE.normalizationDeg * Math.PI / 180;
      return mat;
    };
    const runPlane = (side, rotateY) => {
      const scene = new THREE.Scene();
      const geo = new THREE.PlaneGeometry(2, 2);
      const mesh = new THREE.Mesh(geo, planeMat(side, PROBE.planeThickness));
      mesh.rotation.y = rotateY;
      scene.add(mesh);
      renderSpaced(scene);
      const r = readR();
      mesh.material.dispose(); geo.dispose(); scene.clear();
      return r;
    };
    // —— 2) 真实装配探针（populateSpacedArmorScene + stencil 去重）——
    // 开放壳体：缺一面的盒体（开放 → front/back 双 clone + stencil 位）；
    // 闭合盒体对照组（闭合 → FrontSide 单 clone）。相机沿 +Z 看向原点：
    // 射线依次穿过 pz 面（front，入射）与 nz 面（back，出射）。
    // reversed：翻转绕序 + 法线（绕序朝内的壳）——相机看到的 pz 面变成背面命中、
    // nz 面变成入射面，即 review P2 的「近 Back / 远 Front」同键穿越顺序。
    const buildShell = (open, reversed = false) => {
      const box = new THREE.BoxGeometry(2, 2, 2);
      if (!open) return box;
      const trimmed = new THREE.BufferGeometry();
      // 必须连同 normal 属性一起复制：真实装甲网格总是带法线，缺法线时
      // SPACED_FRAG 的 normalize(vNormal) 退化为 NaN → cos 下界 → 假阳性 600000。
      trimmed.setAttribute('position', box.attributes.position);
      trimmed.setAttribute('normal', box.attributes.normal);
      trimmed.setIndex(Array.from(box.index.array.slice(6)));   // 去掉第一个面 → 开放
      box.dispose();
      if (reversed) {
        const idx = trimmed.index.array;
        for (let i = 0; i + 2 < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t }
        const n = trimmed.attributes.normal;
        for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
        n.needsUpdate = true;
        trimmed.index.needsUpdate = true;
      }
      return trimmed;
    };
    const runAssembly = (open, reversed = false) => {
      const src = new THREE.Scene();
      const primary = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.2), new THREE.MeshBasicMaterial());
      primary.position.z = -2;
      primary.userData.armorSection = 'hull';
      primary.userData.armorThickness = 40;
      const shell = new THREE.Mesh(buildShell(open, reversed), new THREE.MeshBasicMaterial());
      shell.userData.armorSection = 'spaced';
      shell.userData.armorSectionOrig = 'gun';
      shell.userData.armorPlateId = '2';
      shell.userData.armorThickness = PROBE.thickness;
      src.add(primary, shell);
      src.updateMatrixWorld(true);
      const mats = {
        omit: new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true }),
        spacedOmit: new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true, side: THREE.DoubleSide }),
        externalDepth: new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true }),
        spacedMaterial: ctx.spacedMaterial,
        externalMaterial: ctx.externalMaterial,
      };
      const spacedScene = new THREE.Scene();
      plate.populateSpacedArmorScene(spacedScene, { primary: [primary], spaced: [shell], external: [] }, mats, PROBE.penetration, null);
      // 与生产 uniform 同步（buildSpacedArmorScene 之后由 updateSpacedUniforms 写入）。
      spacedScene.traverse((node) => {
        const u = node.isMesh && node.material && node.material.uniforms;
        if (!u) return;
        if (u.caliber) u.caliber.value = PROBE.caliber;
        if (u.normalization) u.normalization.value = PROBE.normalizationDeg * Math.PI / 180;
      });
      renderSpaced(spacedScene);
      const single = readR();
      // 负向对照：把 back clone 的 stencil 测试改成 Always（模拟「去重失效」）——
      // 出射面会再计一次 → R ≈ 2×；证明上面的断言不是空断言。
      const backClone = spacedScene.children.find((n) => n.isMesh && n.renderOrder === 2.1 && n.material.uniforms);
      let broken = null;
      if (open && backClone) {
        const savedFunc = backClone.material.stencilFunc;
        backClone.material.stencilFunc = THREE.AlwaysStencilFunc;
        renderSpaced(spacedScene);
        broken = readR();
        backClone.material.stencilFunc = savedFunc;
      }
      spacedScene.traverse((node) => { if (node.isMesh && node.material && node.material.dispose) node.material.dispose(); if (node.isMesh && node.geometry && node.geometry.dispose) node.geometry.dispose(); });
      spacedScene.clear();
      primary.geometry.dispose(); shell.geometry.dispose();
      return { single, broken };
    };
    // —— 2) 同键只有背面（两片背面朝向相机、无入射面）——
    // back clone 无位可测 → 逐片元累计 2×；与 resolveSpacedHitMask 的
    // 「无入射面 → 出射面全部计入」同口径。
    const runTwoBackFaces = () => {
      const quad = (z) => [
        -1, -1, z,  1, 1, z,  1, -1, z,
        -1, -1, z,  -1, 1, z,  1, 1, z,
      ];
      const positions = new Float32Array([...quad(1), ...quad(-1)]);
      const normals = new Float32Array(positions.length);
      for (let i = 2; i < normals.length; i += 3) normals[i] = -1;   // 法线 -Z：相机在 +Z 看是背面
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      const primary = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.2), new THREE.MeshBasicMaterial());
      primary.position.z = -2;
      primary.userData.armorSection = 'hull';
      primary.userData.armorThickness = 40;
      const shell = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      shell.userData.armorSection = 'spaced';
      shell.userData.armorSectionOrig = 'gun';
      shell.userData.armorPlateId = '9';
      shell.userData.armorThickness = PROBE.thickness;
      const src = new THREE.Scene();
      src.add(primary, shell);
      src.updateMatrixWorld(true);
      const mats = {
        omit: new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true }),
        spacedOmit: new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true, side: THREE.DoubleSide }),
        externalDepth: new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true }),
        spacedMaterial: ctx.spacedMaterial,
        externalMaterial: ctx.externalMaterial,
      };
      const spacedScene = new THREE.Scene();
      plate.populateSpacedArmorScene(spacedScene, { primary: [primary], spaced: [shell], external: [] }, mats, PROBE.penetration, null);
      spacedScene.traverse((node) => {
        const u = node.isMesh && node.material && node.material.uniforms;
        if (!u) return;
        if (u.caliber) u.caliber.value = PROBE.caliber;
        if (u.normalization) u.normalization.value = PROBE.normalizationDeg * Math.PI / 180;
      });
      renderSpaced(spacedScene);
      const r = readR();
      spacedScene.traverse((node) => { if (node.isMesh && node.material && node.material.dispose) node.material.dispose(); if (node.isMesh && node.geometry && node.geometry.dispose) node.geometry.dispose(); });
      spacedScene.clear();
      primary.geometry.dispose(); geo.dispose();
      return r;
    };
    const openAssembly = runAssembly(true);
    const reversedAssembly = runAssembly(true, true);
    const closedAssembly = runAssembly(false);
    const out = {
      frontPlane: runPlane(THREE.FrontSide, 0),
      backPlane: runPlane(THREE.BackSide, Math.PI),
      backCulled: runPlane(THREE.BackSide, 0),
      openShellR: openAssembly.single,
      openShellBrokenR: openAssembly.broken,
      reversedShellR: reversedAssembly.single,
      reversedShellBrokenR: reversedAssembly.broken,
      closedShellR: closedAssembly.single,
      twoBackFacesR: runTwoBackFaces(),
    };
    renderer.dispose();
    return out;
  })()`)

  const near = (a, b) => Math.abs(a - b) <= PROBE.tolerance
  // 1) 真实装配 + stencil 去重：开放壳体出射面被抑制，只计入射面一次。
  check(near(result.openShellR, PROBE.expectedShellSingle),
    `开放壳体经真实装配只计一次：RT0.R = ${PROBE.expectedShellSingle}（实际 ${result.openShellR}；去重失效时 ≈ 2×）`)
  // 2) 闭合对照（FrontSide 单 clone）。
  check(near(result.closedShellR, PROBE.expectedShellSingle),
    `闭合盒体对照：RT0.R = ${PROBE.expectedShellSingle}（实际 ${result.closedShellR}）`)
  // 2b) 负向对照：关闭 stencil 抑制后出射面再计一次（≈2×），证明上一条断言有判别力。
  check(result.openShellBrokenR !== null && near(result.openShellBrokenR, PROBE.expectedShellSingle * 2),
    `负向对照（stencil Always）：RT0.R ≈ 2× = ${PROBE.expectedShellSingle * 2}（实际 ${result.openShellBrokenR}）`)
  // 2c) review P2：同键近 Back / 远 Front（反绕序开放壳）——front clone 仍先置位，
  //     只计一次；负向对照证明该场景确实存在「出射面若不抑制就再计一次」的片元。
  check(near(result.reversedShellR, PROBE.expectedShellSingle),
    `反绕序开放壳（近 Back / 远 Front）只计一次：RT0.R = ${PROBE.expectedShellSingle}（实际 ${result.reversedShellR}）`)
  check(result.reversedShellBrokenR !== null && near(result.reversedShellBrokenR, PROBE.expectedShellSingle * 2),
    `反绕序负向对照（stencil Always）：RT0.R ≈ 2× = ${PROBE.expectedShellSingle * 2}（实际 ${result.reversedShellBrokenR}）`)
  // 2d) review P2：同键只有背面（无入射面）→ back clone 无位可测，逐片元累计 2×；
  //     与点击链 resolveSpacedHitMask「无入射面则出射面全部计入」同口径。
  check(near(result.twoBackFacesR, PROBE.expectedShellSingle * 2),
    `同键仅背面（无入射面）逐片元累计：RT0.R = ${PROBE.expectedShellSingle * 2}（实际 ${result.twoBackFacesR}）`)
  // 3) 单 plane 材质：FLIP_SIDED 背面法线。
  check(near(result.frontPlane, PROBE.expectedPlane),
    `正面屏 R = ${PROBE.expectedPlane}（实际 ${result.frontPlane}）`)
  check(near(result.backPlane, PROBE.expectedPlane),
    `背面屏 R = ${PROBE.expectedPlane}——FLIP_SIDED 翻回几何法线（实际 ${result.backPlane}；修复前 ≈ ${PROBE.planeThickness / PROBE.penetration * 1e6}）`)
  check(near(result.backCulled, 0),
    `BackSide 正对相机被剔除，R = 0（实际 ${result.backCulled}）`)

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