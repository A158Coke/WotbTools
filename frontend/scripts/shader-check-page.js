// 着色器编译自检的**页面侧**（由 vite 以模块 URL 伺服：裸 'three' 被重写成与
// sceneryMaterials.js 同一份依赖实例；写在中间件内联 HTML 里则解析不了——上一版即卡在这）。
import * as THREE from 'three'
import {
  makeLightmappedMaterial, makeBlendLayerMaterial, makeSkyMaterial,
  makeBillboardMaterial, makeBlendByAngleMaterial, makeSpeedtreeStaticMaterial, makeWaterMaterial,
  makeDecalMaterial, patchTankMaterial,
} from '../src/scene/sceneryMaterials.js'
import { applyTankDestroyedVisual, prepareTankDestroyedVisual } from '../src/scene/tankDestroyedVisual.js'
import { FX_BUDGETS, createBattleFx } from '../src/scene/battleFx.js'
import { groundShaderMaterial } from '../src/scene/groundPass.js'
import { createArmorShaderContext, standardDepthMaterial } from '../src/scene/viewer/armorShaders.js'

window.__step = 'module-start'
const log = []
const origErr = console.error.bind(console)
console.error = (...a) => { log.push(a.map((x) => (x && x.stack) ? x.stack : String(x)).join(' ').slice(0, 6000)); origErr(...a) }

const tex = () => { const t = new THREE.DataTexture(new Uint8Array([255, 200, 150, 255]), 1, 1); t.needsUpdate = true; return t }
function geo({ uv1 = true, corner = false, color = false } = {}) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2))
  if (uv1) g.setAttribute('uv1', new THREE.Float32BufferAttribute([0.1, 0.1, 0.9, 0.1, 0.5, 0.9], 2))
  const white4 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  if (corner) { g.setAttribute('_corner', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1], 4)); g.setAttribute('color', new THREE.Float32BufferAttribute(white4, 4)) }
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(white4, 4))
  return g
}
const fakeMat = (over = {}) => Object.assign(new THREE.MeshStandardMaterial({ map: tex(), name: 'fake' }), over)

const T = tex()
// 环境反射材质：遮罩+立方图+逐材质属性（缺省按客户端 property 默认值）
const envObj = {
  maskTex: T, cubeTex: T,
  props: { reflectionSpecParamGloss: 0.6, reflectionMetalFresnelReflectance: [0.4, 0.4, 0.4], reflectionBrightenEnvMap: 2.0 },
}
// 地面材质：分层地表 shader（groundPass 共享实现）——用最小合法 uniform 构造后真编译。
const groundMat = groundShaderMaterial(
  { flatcolor: false, separate_lm: false, scaled_tiles: false, height_blend: false,
    tiling: [1, 1], tile_scale: [1, 1, 1, 1],
    tile_colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]],
    flat_color: [1, 1, 1], lm_adjust: [0, 1, 1], tilemask_weight: 1,
    hb_scale: [1, 1, 1, 1], hb_offset: [0, 0, 0, 0], hb_softness: [1, 1, 1, 1] },
  { cm: T, lm: T, tile0: T, tile1: T, mask0: T, mask1: T, hmap0: T, hmap1: T },
  600, 0, 0,
)

function destroyedTankMaterial(material) {
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(geo(), material)
  root.add(mesh)
  applyTankDestroyedVisual(prepareTankDestroyedVisual(root), 1)
  return mesh.material
}

const cases = [
  ['lightmapped', () => makeLightmappedMaterial(fakeMat(), T), geo()],
  ['lightmapped+detail(B1)', () => makeLightmappedMaterial(fakeMat(), T, null, { tex: T, scale: [3.6, 2.4] }), geo()],
  ['lightmapped+env', () => makeLightmappedMaterial(fakeMat(), T, envObj), geo()],
  ['lightmapped+alphaTest', () => makeLightmappedMaterial(fakeMat({ alphaTest: 0.33 }), T), geo()],
  ['lightmapped+alphaBlend', () => makeLightmappedMaterial(fakeMat({ opacity: 0.5, userData: { alphaBlend: true } }), T), geo()],
  ['blend-layer', () => makeBlendLayerMaterial(fakeMat({ userData: { blendLayer: true, tex0ShiftPerSecond: [0.02, 0] } }), T), geo()],
  ['water', () => makeWaterMaterial(fakeMat(), { normalTex: T, cubeTex: T, props: {
    normal0Scale: 7.7, normal1Scale: 7.0, normal0ShiftPerSecond: [0, 0.015],
    normal1ShiftPerSecond: [-0.01, 0.01], fresnelBias: 0.72, fresnelPow: 0.71,
    reflectionTintColor: [0.7, 0.7, 0.72],
  } }), geo({ uv1: false })],
  // 坦克 PBR：打了环境隔离补丁的 MeshStandardMaterial 必须能编译（补丁注入点在 three 的
  // lights_fragment_begin 之后；门禁场景里有半球光 ⇒ NUM_HEMI_LIGHTS>0 的真实编译路径）
  ['tank-pbr(ambient-isolated)', () => patchTankMaterial(fakeMat()), geo({ uv1: false })],
  ['tank-pbr(destroyed-charcoal)', () => destroyedTankMaterial(fakeMat()), geo({ uv1: false })],
  ['tank-proxy(destroyed-charcoal)', () => destroyedTankMaterial(new THREE.MeshLambertMaterial()), geo({ uv1: false })],
  ['blend-by-angle', () => makeBlendByAngleMaterial(fakeMat(), { bounds: [0, 1], power: 1, inversion: 0 }), geo({ uv1: false })],
  ['sky', () => makeSkyMaterial(fakeMat()), geo({ uv1: false })],
  ['billboard', () => makeBillboardMaterial(fakeMat({ color: new THREE.Color(1.77, 1.77, 1.77) })), geo({ corner: true })],
  ['ST|static', () => makeSpeedtreeStaticMaterial(fakeMat({ name: 'ST|x' }), true), geo({ color: true })],
  ['ST|static+alphaBlend', () => makeSpeedtreeStaticMaterial(fakeMat({ name: 'ST|x', opacity: 0.5, userData: { alphaBlend: true } }), true), geo({ color: true })],
  // 贴花（客户端 MATERIAL_DECAL）：UV1 采地图 colormap、不受光；含 separate_lm 与
  // GLOBAL_TINT 的 brightness/contrast/gamma 调整分支
  ['decal(贴花, UV1×colormap)', () => makeDecalMaterial(fakeMat(), T, T, { separateLm: true, lmAdjust: [0.1, 1.1, 0.9], globalTint: true }), geo()],
  ['decal+alphaBlend', () => makeDecalMaterial(fakeMat({ opacity: 0.5, userData: { alphaBlend: true } }), T, null, {}), geo()],
  ['decal+alphaTest', () => makeDecalMaterial(fakeMat({ alphaTest: 0.33 }), T, null, {}), geo()],
  ['ground(分层地表 shader)', () => groundMat, geo({ uv1: false })],
]

try {
  const renderer = new THREE.WebGLRenderer({ antialias: false })
  renderer.setSize(64, 64)
  document.body.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 2.0))
  // 一盏方向光：让走 three 内建管线的材质（坦克 PBR 等）编译真实的光照分支
  const sun = new THREE.DirectionalLight(0xffffff, 3.0)
  sun.position.set(60, 120, 40)
  scene.add(sun); scene.add(sun.target)
  const built = []
  for (const [name, make, geometry] of cases) {
    const mat = make()
    // 实例化路径（USE_INSTANCING，与真实合批一致）+ 逐实例光照图变换属性
    const mesh = new THREE.InstancedMesh(geometry, mat, 2)
    mesh.setMatrixAt(0, new THREE.Matrix4())
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3, 0, 0))
    mesh.instanceMatrix.needsUpdate = true
    if (geometry.attributes.uv1 && !geometry.attributes.aLm) {
      geometry.setAttribute('aLm', new THREE.InstancedBufferAttribute(new Float32Array([0.0625, 0.0625, 0, 0, 0.0625, 0.0625, 0.5, 0.5]), 4))
    }
    scene.add(mesh)
    built.push(name)
  }
  // 战斗特效（battleFx）：两个实例化粒子批次 + 火星线段 + 曳光/光迹条带。自定义 shader 手挂
  // logdepthbuf 代码块——线性深度与 ?logdepth=1 两种渲染器各编一遍（漏 <common> 只在后者炸）。
  function battleFxScene() {
    const fx = createBattleFx(FX_BUDGETS.ultra)
    const at = (x, y, z) => new THREE.Vector3(x, y, z)
    fx.spawnBurst(at(0, -1, 0), 0, 1)
    fx.spawnMuzzle(at(-2, 0, 0), at(1, 0, 0), 0, 2)
    fx.spawnImpact('pen', at(2, 0, 0), at(1, 0, 0), null, 0, 3)
    fx.setTracer(fx.takeRibbon('tracer'), at(-3, 0.5, 0), at(3, 0.5, 0), 0x3ee08a)
    fx.setTrail(fx.takeRibbon('trail'), at(-3, -0.5, 0), at(3, -0.5, 0), 0xff5a45, 1)
    fx.frame(100, camera, 64, (emit) => { emit.wreck(0, -1, -2, 0, 5, 1, 4); emit.headGlow(at(3, 0.5, 0), 0x3ee08a) })
    return fx
  }
  scene.add(battleFxScene().root)
  built.push('battle-fx(glow/smoke/sparks/tracer/trail)')
  // 穿透材质族：回放开镜着色在 ?logdepth 渲染器下也要编译，两种渲染器各编一遍。
  function armorScene() {
    const ctx = createArmorShaderContext()
    const clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const penetration = ctx.penetrationMaterial(100)
    penetration.uniforms.inverseProjectionMatrix.value = camera.projectionMatrixInverse
    const group = new THREE.Scene()
    for (const material of [
      penetration, ctx.spacedMaterial(50, 200, THREE.DoubleSide), ctx.spacedStateMaterial(50, 200),
      ctx.externalMaterial(20, 200, clip), ctx.moduleStateMaterial(clip), standardDepthMaterial(),
    ]) group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material))
    return group
  }
  renderer.localClippingEnabled = true
  renderer.render(armorScene(), camera)
  built.push('armor-penetration(primary/spaced/external)')
  renderer.render(scene, camera)
  const logRenderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true })
  logRenderer.setSize(64, 64)
  document.body.appendChild(logRenderer.domElement)
  const fxScene = new THREE.Scene()
  fxScene.add(battleFxScene().root)
  logRenderer.render(fxScene, camera)
  built.push('battle-fx(logdepth)')
  logRenderer.localClippingEnabled = true
  logRenderer.render(armorScene(), camera)
  built.push('armor-penetration(logdepth)')
  const programs = [...(renderer.info.programs || []), ...(logRenderer.info.programs || [])].map((p) => ({
    name: p.name,
    diag: p.diagnostics ? {
      runnable: p.diagnostics.runnable,
      programLog: String(p.diagnostics.programLog || '').slice(0, 4000),
      vertexLog: String((p.diagnostics.vertexShader && p.diagnostics.vertexShader.log) || '').slice(0, 3000),
      fragmentLog: String((p.diagnostics.fragmentShader && p.diagnostics.fragmentShader.log) || '').slice(0, 3000),
    } : null,
  }))
  window.__shaderCheck = { cases: built, programs, log }
} catch (e) {
  window.__shaderCheck = { error: (e && e.stack) ? e.stack : String(e), log }
}
window.__shaderCheckDone = true
