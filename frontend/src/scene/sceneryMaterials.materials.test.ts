// 场景 GLB 材质管线行为测试（#827 接替 sceneryMaterials.test.js 的
// :98/:107/:115/:128/:233/:282/:317/:374/:404/:457/:657/:860/:866/:919/:1356 源码守卫）：
// 材质工厂与装配分派（sceneryMaterials.ts / sceneryAssembly.ts）按真实 THREE 对象验证——
// 缓存键分流、伪透明裁切、blendLayer 软 alpha、LM/detail/water/blendByAngle/sky 路由、
// 各向异性去重、Lambert 曝光。
// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'
import {
  makeBillboardMaterial, makeSpeedtreeStaticMaterial, patchTankMaterial,
  applyMaterialTextureAnisotropy, clearSceneryMatCache, SCENERY_LAMBERT_EXPOSURE,
} from './sceneryMaterials.ts'
import { assembleSceneryMaterials } from './sceneryAssembly.ts'
import type { SceneryTexResolvers } from './sceneryAssembly.ts'

const NO_TEX = () => null
const masks = (over: Partial<SceneryTexResolvers> = {}): SceneryTexResolvers => ({
  maskTexOf: NO_TEX, lmTexOf: NO_TEX, detailTexOf: NO_TEX,
  envTexOf: NO_TEX, waterTexOf: NO_TEX, decalTexOf: NO_TEX,
  ...over,
})

beforeEach(() => {
  clearSceneryMatCache()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  clearSceneryMatCache()
  vi.restoreAllMocks()
})

describe('叶卡材质（makeBillboardMaterial）', () => {
  it(':98 不透明管线 + uAlphaCut discard：transparent=false、uAlphaCut=0.33', () => {
    const m = new THREE.MeshStandardMaterial({ name: 'leaf' })
    m.map = new THREE.Texture()
    const mat = makeBillboardMaterial(m as never)
    expect(mat.transparent).toBe(false)
    expect(mat.uniforms.uAlphaCut.value).toBeCloseTo(0.33)
    expect(mat.fragmentShader).toMatch(/if \(c\.a < uAlphaCut\) discard;/)
  })

  it(':107 遮挡均值与 SH 染色取自身 userData.occMean / baseColorFactor（不硬编码）', () => {
    const m = new THREE.MeshStandardMaterial({ name: 'leaf', color: new THREE.Color(0.37, 0.50, 0.50) })
    ;(m.userData as Record<string, unknown>).occMean = 2.5
    const mat = makeBillboardMaterial(m as never)
    expect(mat.uniforms.uOccMean.value).toBe(2.5)
    const sh = mat.uniforms.uSH.value as THREE.Vector3
    expect(sh.x).toBeCloseTo(0.37, 6)
    expect(sh.y).toBeCloseTo(0.50, 6)
    expect(sh.z).toBeCloseTo(0.50, 6)
  })
})

describe('装配分派（assembleSceneryMaterials）', () => {
  const addUv1 = (mesh: THREE.Mesh) => {
    mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(
      new Float32Array(mesh.geometry.attributes.position.count * 2), 2))
  }

  it(':115 伪透明→不透明+alphaTest 0.33；真透明→混合不写深度；镂空继承 alphaTest', () => {
    const root = new THREE.Group()
    const pseudo = new THREE.MeshStandardMaterial({ name: 'pseudo', transparent: true, opacity: 1 })
    pseudo.map = new THREE.Texture()
    const truly = new THREE.MeshStandardMaterial({ name: 'truly', transparent: true, opacity: 0.5 })
    truly.map = new THREE.Texture()
    const masked = new THREE.MeshStandardMaterial({ name: 'masked', alphaTest: 0.4 })
    masked.map = new THREE.Texture()
    const mPseudo = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), pseudo)
    const mTruly = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), truly)
    const mMasked = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), masked)
    root.add(mPseudo, mTruly, mMasked)
    assembleSceneryMaterials({ scene: root } as never, { strictSurfaces: true, masks: masks() })
    // 伪透明（BLEND 且 opacity≈1、无标记）→ 不透明 + 裁切
    const pm = mPseudo.material as THREE.MeshLambertMaterial
    expect(pm.transparent).toBe(false)
    expect(pm.alphaTest).toBeGreaterThanOrEqual(0.33)
    // 真透明 → 保持混合、不写深度
    const tm = mTruly.material as THREE.MeshLambertMaterial
    expect(tm.transparent).toBe(true)
    expect(tm.depthWrite).toBe(false)
    // 镂空：GLTFLoader 解析的 alphaTest 原样继承（MASK 不裁 = 整片方片照绘）
    const km = mMasked.material as THREE.MeshLambertMaterial
    expect(km.alphaTest).toBeCloseTo(0.4)
  })

  it(':128 真混合层（extras.blendLayer）保留软 alpha：不被伪透明分流削成裁切卡片；缓存键含标记', () => {
    const root = new THREE.Group()
    const smoke = new THREE.MeshStandardMaterial({ name: 'smoke_layer', transparent: true, opacity: 1 })
    smoke.map = new THREE.Texture()
    ;(smoke.userData as Record<string, unknown>).blendLayer = { tex0ShiftPerSecond: [0, 0] }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), smoke)
    addUv1(mesh)
    root.add(mesh)
    const maskTex = new THREE.Texture()
    const asm = assembleSceneryMaterials({ scene: root } as never, {
      strictSurfaces: true, masks: masks({ maskTexOf: () => maskTex }),
    })
    const mat = mesh.material as THREE.ShaderMaterial
    // 软混合：混合队列 + 不写深度（掩码 alpha 是软渐变，裁切会削成硬边卡片）
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)
    // 带回放时钟的材质被装配登记（宿主 tick 消费 animLayerMats 推进 uTime）
    expect(asm.animLayerMats).toContain(mat)
    expect(mat.uniforms.uTime).toBeTruthy()
    // 缓存键含 alphaBlend 标记（软混合走 convMat 时）：标记不同 ⇒ 不同实例（不串用）
    const softTex = new THREE.Texture()
    const mkSoft = (marked: boolean, name: string) => {
      const mm = new THREE.MeshStandardMaterial({ name, transparent: true, opacity: 0.5 })
      mm.map = softTex
      if (marked) (mm.userData as Record<string, unknown>).alphaBlend = true
      const mesh3 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mm)
      root.add(mesh3)
      return mesh3
    }
    const s1 = mkSoft(true, 'fade_a')
    const s2 = mkSoft(true, 'fade_a')
    const s3 = mkSoft(false, 'fade_a')
    assembleSceneryMaterials({ scene: root } as never, { strictSurfaces: true, masks: masks() })
    expect(s2.material).toBe(s1.material)   // 同输入 → 缓存命中（同实例）
    expect(s3.material).not.toBe(s1.material) // 无标记（会被伪透明分流）→ 不同实例
  })

  it(':233 water extras（对象）→ makeWaterMaterial 专用材质（透明 + 写深度 + 双面）', () => {
    const root = new THREE.Group()
    const waterMat = new THREE.MeshStandardMaterial({ name: 'water', transparent: true, opacity: 0.8 })
    ;(waterMat.userData as Record<string, unknown>).water = { props: { fresnelBias: 0.2 } }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), waterMat)
    root.add(mesh)
    const normalTex = new THREE.Texture(), cubeTex = new THREE.Texture()
    assembleSceneryMaterials({ scene: root } as never, {
      strictSurfaces: true,
      masks: masks({ waterTexOf: () => [normalTex, cubeTex] }),
    })
    const mat = mesh.material as THREE.ShaderMaterial
    expect(mat.isShaderMaterial).toBe(true)
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(true)   // 水面不写深度会与地形逐像素闪
    expect(mat.side).toBe(THREE.DoubleSide)
    expect(mat.uniforms.normalmap.value).toBe(normalTex)
    expect(mat.uniforms.cubemap.value).toBe(cubeTex)
  })

  it(':282 LM extras → 光照图材质（不受光 ShaderMaterial），aLm 输入契约保留', () => {
    const root = new THREE.Group()
    const lmMat = new THREE.MeshStandardMaterial({ name: 'lm_static' })
    lmMat.map = new THREE.Texture()
    ;(lmMat.userData as Record<string, unknown>).lightmap = { uvScale: [1, 1], uvOffset: [0, 0] }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lmMat)
    addUv1(mesh)
    root.add(mesh)
    const atlas = new THREE.Texture()
    assembleSceneryMaterials({ scene: root } as never, {
      strictSurfaces: true, masks: masks({ lmTexOf: () => atlas }),
    })
    const mat = mesh.material as THREE.ShaderMaterial
    expect(mat.isShaderMaterial).toBe(true)
    // 不受光：烘焙结果是静态的，着色器里没有任何光照项
    expect(mat.fragmentShader).not.toMatch(/lambert|lights_/i)
    expect(mat.uniforms.lightmap.value).toBe(atlas)
    expect(mat.uniforms.map.value).toBe(lmMat.map)
    // 逐实例 UV 变换走 aLm 实例属性（材质无关）：顶点着色器声明 aLm 属性
    expect(mat.vertexShader).toMatch(/attribute vec4 aLm;/)
    expect(mat.vertexShader).toMatch(/vLmUv = uv1 \* aLm\.xy \+ aLm\.zw;/)
  })

  it(':1356 LM 材质按输入指纹缓存：共享同一图集+同一 glTF 材质的两个网格拿到同一实例', () => {
    const root = new THREE.Group()
    const atlas = new THREE.Texture()
    // 真实 GLB 里多个节点共享同一份 glTF 材质（LM 缓存键含 m.uuid）
    const sharedMat = new THREE.MeshStandardMaterial({ name: 'lm_shared' })
    sharedMat.map = new THREE.Texture()
    ;(sharedMat.userData as Record<string, unknown>).lightmap = { uvScale: [1, 1], uvOffset: [0, 0] }
    const makeLmMesh = () => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMat)
      addUv1(mesh)
      root.add(mesh)
      return mesh
    }
    const a = makeLmMesh()
    const b = makeLmMesh()
    assembleSceneryMaterials({ scene: root } as never, {
      strictSurfaces: true, masks: masks({ lmTexOf: () => atlas }),
    })
    expect(a.material).toBe(b.material)
    expect(a.material).not.toBe(sharedMat)
    // 逐 mesh 新建会把 (几何,材质) 合批拆成单实例批：缓存命中 = 同一实例
    //（缓存键 = LM#m.uuid#atlas.uuid；真 GLB 多节点共享同一份 glTF 材质）
    const root2 = new THREE.Group()
    const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMat)
    addUv1(c)
    root2.add(c)
    assembleSceneryMaterials({ scene: root2 } as never, {
      strictSurfaces: true, masks: masks({ lmTexOf: () => atlas }),
    })
    expect(c.material).toBe(a.material)
  })

  it(':317 detail extras → LM 材质 detail 槽 / Lambert 材质 patchSceneryDetail 补丁；键含 detail 身份', () => {
    const root = new THREE.Group()
    const atlas = new THREE.Texture(), detailTex = new THREE.Texture()
    const lmMat = new THREE.MeshStandardMaterial({ name: 'lm_detail' })
    lmMat.map = new THREE.Texture()
    ;(lmMat.userData as Record<string, unknown>).lightmap = { uvScale: [1, 1], uvOffset: [0, 0] }
    ;(lmMat.userData as Record<string, unknown>).detail = { scale: [4, 4] }
    const lmMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lmMat)
    addUv1(lmMesh)
    // 无光照图的 Lambert 分支：detail 走 onBeforeCompile 补丁
    const plainMat = new THREE.MeshStandardMaterial({ name: 'plain_detail' })
    plainMat.map = new THREE.Texture()
    ;(plainMat.userData as Record<string, unknown>).detail = { scale: [8, 8] }
    const plainMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), plainMat)
    root.add(lmMesh, plainMesh)
    assembleSceneryMaterials({ scene: root } as never, {
      strictSurfaces: true,
      masks: masks({ lmTexOf: () => atlas, detailTexOf: () => detailTex }),
    })
    const lm = lmMesh.material as THREE.ShaderMaterial
    expect(lm.uniforms.uDetailTex.value).toBe(detailTex)
    expect((lm.uniforms.uDetailScale.value as THREE.Vector2).x).toBe(4)
    // Lambert 补丁：program 缓存键带标记（与坦克补丁同法，防串用未打补丁程序）
    const plain = plainMesh.material as THREE.MeshLambertMaterial
    expect(plain.customProgramCacheKey?.()).toContain('|scenery-detail')
    // 同键缓存：同 detail 身份（同一 glTF 材质共享）再装配 → 同一 LM 实例
    const root2 = new THREE.Group()
    const lmMesh2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lmMat)
    addUv1(lmMesh2)
    root2.add(lmMesh2)
    assembleSceneryMaterials({ scene: root2 } as never, {
      strictSurfaces: true,
      masks: masks({ lmTexOf: () => atlas, detailTexOf: () => detailTex }),
    })
    expect(lmMesh2.material).toBe(lm)
  })

  it(':657 extras.blendByAngle → makeBlendByAngleMaterial（软混合 + 客户端视角因子 uniforms）', () => {
    const root = new THREE.Group()
    const m = new THREE.MeshStandardMaterial({ name: 'rays', transparent: true, opacity: 1 })
    m.map = new THREE.Texture()
    ;(m.userData as Record<string, unknown>).blendByAngle = { bounds: [0.1, 0.9], power: 2, inversion: 1 }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m)
    root.add(mesh)
    assembleSceneryMaterials({ scene: root } as never, { strictSurfaces: true, masks: masks() })
    const mat = mesh.material as THREE.ShaderMaterial
    expect(mat.isShaderMaterial).toBe(true)
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)   // 客户端 AlphaBlend 预设
    const bounds = mat.uniforms.uBounds.value as THREE.Vector2
    expect(bounds.x).toBeCloseTo(0.1)
    expect(bounds.y).toBeCloseTo(0.9)
    expect(mat.uniforms.uPower.value).toBe(2)
    expect(mat.uniforms.uInversion.value).toBe(1)
  })

  it(':866 天穹：extras.sky → makeSkyMaterial（无限远投影 + 不写深度 + 不参与雾）；水材质标记优先于 sky 名', () => {
    const root = new THREE.Group()
    const skyMat = new THREE.MeshStandardMaterial({ name: 'skyobject_mat' })
    ;(skyMat.userData as Record<string, unknown>).sky = true
    const sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skyMat)
    // NewBay SkySeaSurface：名字含 sky，但材质是 extras.water → 必须走水面路径（曾为用户 bug）
    const seaMat = new THREE.MeshStandardMaterial({ name: 'sea', transparent: true })
    ;(seaMat.userData as Record<string, unknown>).water = { props: {} }
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), seaMat)
    sea.name = 'SkySeaSurface.sc2'
    root.add(sky, sea)
    const normalTex = new THREE.Texture(), cubeTex = new THREE.Texture()
    const asm = assembleSceneryMaterials({ scene: root } as never, {
      strictSurfaces: true,
      masks: masks({ waterTexOf: () => [normalTex, cubeTex] }),
    })
    const skyM = sky.material as THREE.ShaderMaterial
    expect(skyM.isShaderMaterial).toBe(true)
    expect(sky.userData.isSky).toBe(true)
    expect(sky.frustumCulled).toBe(false)
    expect(skyM.depthWrite).toBe(false)
    expect(skyM.fog).toBe(false)
    expect(skyM.side).toBe(THREE.DoubleSide)
    expect(asm.skyMeshes).toBe(1)
    // 海面：名字命中 /sky/ 也不走天空路径（水材质优先）
    expect((sea.material as THREE.ShaderMaterial).uniforms.cubemap).toBeTruthy()
    expect(sea.userData.isSky).toBeUndefined()
  })

  it(':860 convMat Lambert 曝光修整：color × SCENERY_LAMBERT_EXPOSURE（只作用于装配建出的材质）', () => {
    const root = new THREE.Group()
    const m = new THREE.MeshStandardMaterial({ name: 'rock', color: new THREE.Color(0.8, 0.4, 0.2) })
    m.map = new THREE.Texture()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m)
    root.add(mesh)
    assembleSceneryMaterials({ scene: root } as never, { strictSurfaces: true, masks: masks() })
    const mat = mesh.material as THREE.MeshLambertMaterial
    expect(mat.color.r).toBeCloseTo(0.8 * SCENERY_LAMBERT_EXPOSURE, 6)
    expect(mat.color.g).toBeCloseTo(0.4 * SCENERY_LAMBERT_EXPOSURE, 6)
    expect(mat.color.b).toBeCloseTo(0.2 * SCENERY_LAMBERT_EXPOSURE, 6)
  })

  it(':804 水面（半透明大面）逐材质修整：depthWrite=true + DoubleSide + 不设 renderOrder', () => {
    const root = new THREE.Group()
    const m = new THREE.MeshStandardMaterial({ name: 'env_ma_water', transparent: true, opacity: 0.9 })
    m.map = new THREE.Texture()
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), m)
    mesh.name = 'env_ma_water'   // 旧包名字启发式（无 surfaceFlags 标记的包）
    root.add(mesh)
    assembleSceneryMaterials({ scene: root } as never, { strictSurfaces: false, masks: masks() })
    const mat = mesh.material as THREE.MeshLambertMaterial
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(true)
    expect(mat.side).toBe(THREE.DoubleSide)
    expect(mesh.renderOrder).toBe(0)   // 不设 renderOrder：交给透明队列按相机距离排序
  })
})

describe('坦克环境光隔离（patchTankMaterial）', () => {
  it(':404 幂等（两次不重打）+ envMapIntensity 设置', () => {
    const m = new THREE.MeshStandardMaterial({ name: 'hull' })
    const once = patchTankMaterial(m)
    expect(once).toBe(m)
    expect(m.envMapIntensity).toBe(1)
    const firstKey = m.customProgramCacheKey?.()
    expect(firstKey).toContain('|tank-noambient')
    const again = patchTankMaterial(m)
    expect(again).toBe(m)
    expect(m.customProgramCacheKey?.()).toBe(firstKey)   // 幂等：program 键不叠标记
    expect((m.userData as Record<string, unknown>).__tankAmbientFixed).toBe(true)
  })
})

describe(':919 场景贴图各向异性（applyMaterialTextureAnisotropy）', () => {
  it('uniform 纹理与直接属性纹理都设 anisotropy；同贴图跨材质只设一次', () => {
    const tex = new THREE.Texture()
    const shared = new THREE.Texture()
    const setSpy = vi.spyOn(tex, 'needsUpdate', 'set')
    const m1 = new THREE.MeshStandardMaterial({ map: tex })
    const sm = new THREE.MeshStandardMaterial({ map: shared })
    const shader = new THREE.MeshBasicMaterial()
    const root = new THREE.Group()
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m1)
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sm)
    root.add(a, b)
    const n = applyMaterialTextureAnisotropy(root, 8)
    expect(tex.anisotropy).toBe(8)
    expect(shared.anisotropy).toBe(8)
    expect(n).toBeGreaterThan(0)
    // ShaderMaterial 的贴图挂在 uniforms 上：人工构造后枚举不漏
    const shaderMat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex } } })
    const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shaderMat)
    root.add(c)
    applyMaterialTextureAnisotropy(root, 4)
    expect(tex.anisotropy).toBe(4)
    setSpy.mockRestore()
  })
})

describe(':457 采样空间（显示内容 vs 原样采样）', () => {
  it('自定义材质一律原样采样（NoColorSpace）；基地标记画布是显示内容（SRGB）', async () => {
    // 自定义材质侧：叶卡贴图强制 NoColorSpace（伽马直采直写）
    const m = new THREE.MeshStandardMaterial({ name: 'leaf' })
    m.map = new THREE.Texture()
    makeBillboardMaterial(m as never)
    expect(m.map.colorSpace).toBe(THREE.NoColorSpace)
    // 显示内容侧：基地标记画布 → CanvasTexture SRGB（createBaseMarkers）
    const { createBaseMarkers } = await import('./playback/bases.js')
    const scene = new THREE.Scene()
    const store = { baseViews: [] as unknown[] } as never
    const markers = createBaseMarkers({
      getScene: () => scene,
      getCamera: () => new THREE.PerspectiveCamera(),
      getData: () => ({ supremacy_bases: [{ base_id: 'A', team: 0 }] }) as never,
      getMapBases: () => ({ supremacy: [{ baseId: 'A', x: 10, y: 10, radius: 15 }] }) as never,
      store,
      groundY: () => 0,
    })
    markers.build()
    const canvasTex = scene.children
      .flatMap((c) => (c as THREE.Mesh).material ? [(c as THREE.Mesh).material as THREE.Material] : [])
      .flatMap((mm) => (mm as THREE.MeshBasicMaterial).map ? [(mm as THREE.MeshBasicMaterial).map as THREE.Texture] : [])
    expect(canvasTex.length).toBeGreaterThan(0)
    expect(canvasTex[0].colorSpace).toBe(THREE.SRGBColorSpace)
    markers.clear()
  })
})
