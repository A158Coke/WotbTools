// 地面 pass SSOT 守卫（src/scene/groundPass.js；2026-10-14 抽层，用户裁示"直接完全照搬
// 3D 回放的代码接入渲染"）：
//   ① 地形数据/几何、分层地表材质、水面海岸线资源只有一处实现——3D 运行时（playbackScene）
//      与俯视烘焙（scripts/bake-ground-overhead.mjs）两侧消费同一模块，本地不得复辟副本；
//   ② 烘焙接入面完整：terrain.json/bin → loadTerrain；ground.layers.json → fail-closed 读取
//      （scripts/bake-ground-layers.js，键集 groundLayerKeys）/setupGroundTextures；地面网格/材质进场景；
//      水件保留（keepWater）并入装配；meta 携带 ground 标志（合成器据它以"覆盖即替换"口径合并，
//      tools/composite_overhead.py）——ground=true 只能来自分层地面网格真正建成。
// 背景：抽层前烘焙不渲染地面——底图是客户端自带地图图（ground.webp），与 3D 档的实时分层
// 渲染（cm×lm×tile/mask）在夜图/带 lm 图上差异显著（faust 用户报障"webp 与 3D 俯视图差
// 别大"的直接来源）。
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadTerrain, makeGroundMaterial } from './groundPass.js'
import { assembleSceneryMaterials } from './sceneryAssembly.js'

const here = dirname(fileURLToPath(import.meta.url))
const strip = (s) => s.replace(/\r\n/g, '\n')   // LF 归一（CRLF 检出下 LF 锚点不匹配，CI 为 LF）
  .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const gpSrc = strip(readFileSync(resolve(here, 'groundPass.js'), 'utf8'))
const src = strip(readFileSync(resolve(here, 'playbackScene.js'), 'utf8'))
// 场景装配块 2026-10-24 出仓 playback/mapAssets.js（Step A3），运行时侧装配守卫随实现迁移
const mapAssetsSrc = strip(readFileSync(resolve(here, 'playback/mapAssets.js'), 'utf8'))
const bakeSrc = strip(readFileSync(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'), 'utf8'))
const bakeLayersSrc = strip(readFileSync(resolve(here, '..', '..', 'scripts', 'bake-ground-layers.js'), 'utf8'))

describe('地面 pass SSOT（groundPass.js）：两侧消费同一份，本地零副本', () => {
  it('模块导出五个共享入口（材质/几何/数据/海岸线/贴图契约）', () => {
    expect(gpSrc).toMatch(/export function groundLayerKeys\(L\) \{/)
    expect(gpSrc).toMatch(/export function setupGroundTextures\(texs, anisotropy\) \{/)
    expect(gpSrc).toMatch(/export async function loadTerrain\(\{ binUrl, metaUrl, fetchFn, stale = \(\) => false \}\) \{/)
    expect(gpSrc).toMatch(/export function buildGroundGeometry\(\{/)
    expect(gpSrc).toMatch(/export function makeGroundMaterial\(\{ layers = null, texs = null, size, cx = 0, cz = 0, mapTexture = null \}\) \{/)
    expect(gpSrc).toMatch(/export function groundShaderMaterial\(L, texs, size, cx, cz\) \{/)
    expect(gpSrc).toMatch(/export function makeWaterCoast\(\{ field, n, span, near, far, depthBits = 24 \}\) \{/)
  })

  it('运行时侧：消费共享入口，本地不得再持有地面着色器/海岸线构造/地形解码副本', () => {
    expect(src).toMatch(/from '\.\/groundPass\.js'/)
    expect(src).toMatch(/buildGroundGeometry\(\{/)
    expect(src).toMatch(/makeGroundMaterial\(\{/)
    expect(mapAssetsSrc).toMatch(/waterCoast = makeWaterCoast\(\{/)
    expect(src).toMatch(/const need = groundLayerKeys\(L\);/)
    expect(src).toMatch(/setupGroundTextures\(texs, ani\);/)
    expect(src).toMatch(/const \{ field, meta: tmeta, metaStatus, binStatus \} = await loadTerrain\(\{/)
    // 副本禁令（本地零残留）
    expect(src).not.toMatch(/function groundShaderMaterial/)
    expect(src).not.toMatch(/uniform sampler2D uCM;/)
    expect(src).not.toMatch(/new THREE\.DataTexture\(heightField/)
    expect(src).not.toMatch(/decodeTerrainField\(/)
    expect(src).not.toMatch(/pairedTerrainBinUrl\(/)
  })

  it('烘焙侧：消费共享入口，本地不得复辟地面代码', () => {
    expect(bakeSrc).toMatch(/from '\/src\/scene\/groundPass\.js'/)
    expect(bakeSrc).toMatch(/loadTerrain\(\{/)
    // 分层读取：页面导入 fail-closed 读取模块；键集仍取共享 groundLayerKeys（不复制层清单）
    expect(bakeSrc).toMatch(/import \{ loadBakeGroundLayers, requireBakeTerrain \} from '\/scripts\/bake-ground-layers\.js'/)
    expect(bakeLayersSrc).toMatch(/import \{ groundLayerKeys \} from '\.\.\/src\/scene\/groundPass\.js'/)
    expect(bakeLayersSrc).toMatch(/for \(const k of groundLayerKeys\(layers\)\) \{/)
    expect(bakeLayersSrc).not.toMatch(/'tile0'|'mask0'|'hmap0'/)
    expect(bakeSrc).toMatch(/setupGroundTextures\(groundLayers\.texs,/)
    expect(bakeSrc).toMatch(/buildGroundGeometry\(\{/)
    expect(bakeSrc).toMatch(/makeGroundMaterial\(\{/)
    expect(bakeSrc).toMatch(/makeWaterCoast\(\{/)
    expect(bakeSrc).not.toMatch(/function groundShaderMaterial/)
    expect(bakeSrc).not.toMatch(/uniform sampler2D uCM;/)
    expect(bakeSrc).not.toMatch(/function decodeTerrainField/)
  })

  it('地形读取 fail-closed：meta 不完整/非居中 bounds 不得按缺省 layout/zmax 解码', () => {
    expect(gpSrc).toMatch(/if \(!terrainFieldMetaValid\(meta\)\) \{/)
    expect(gpSrc).toMatch(/terrainBoundsOk\(meta\)/)
    expect(gpSrc).toMatch(/Number\.isFinite\(Number\(meta\.span\)\)/)
    expect(gpSrc).toMatch(/拒绝按缺省值解码/)
  })

  it('贴图上传契约单实现：tile/hmap Repeat + 全层各向异性都在共享函数里', () => {
    expect(gpSrc).toMatch(/for \(const k of \['tile0', 'tile1', 'hmap0', 'hmap1'\]\) if \(texs\[k\]\) \{/)
    expect(gpSrc).toMatch(/texs\[k\]\.wrapS = texs\[k\]\.wrapT = THREE\.RepeatWrapping;/)
    expect(gpSrc).toMatch(/for \(const k of \['cm', 'lm', 'mask0', 'mask1'\]\) if \(texs\[k\]\) \{/)
    // cm/lm/mask 不得设 colorSpace（legacy DXT 原样采样口径 C3）——共享函数内零 colorSpace 写入
    const setupFn = gpSrc.slice(gpSrc.indexOf('export function setupGroundTextures'),
      gpSrc.indexOf('export async function loadTerrain'))
    expect(setupFn.length).toBeGreaterThan(200)
    expect(setupFn).not.toMatch(/colorSpace/)
  })
})

describe('loadTerrain fail-closed（runtime 口径）', () => {
  const size = 4
  const bin = new Uint16Array(size * size).buffer
  const valid = {
    size, terrainLayout: 2, zmin: 0, zmax: 10, span: 600,
    worldBounds: { min: [-300, -300, 0], max: [300, 300, 10] },
  }
  const resp = (status, body) => ({
    status, ok: status >= 200 && status < 300,
    json: async () => body, arrayBuffer: async () => bin,
  })
  const run = (meta, metaStatus = 200, binStatus = 200) => loadTerrain({
    binUrl: '/map/x/terrain.u16.bin', metaUrl: '/map/x/terrain.json',
    fetchFn: async (u) => (u.includes('terrain.json') ? resp(metaStatus, meta) : resp(binStatus, null)),
  })

  it('完整 meta + 居中 bounds ⇒ 解码', async () => {
    const r = await run(valid)
    expect(r.field).toBeInstanceOf(Float32Array)
    expect(r.metaStatus).toBe(200)
    expect(r.binStatus).toBe(200)
  })

  it('meta 404 + bin 200 ⇒ field=null（不得按缺省 layout/zmax 解码）', async () => {
    const r = await run({}, 404, 200)
    expect(r.field).toBeNull()
    expect(r.metaStatus).toBe(404)
    expect(r.binStatus).toBe(200)
  })

  it('meta 缺 layout / 缺 zmax / 非居中 bounds ⇒ field=null', async () => {
    expect((await run({ ...valid, terrainLayout: undefined })).field).toBeNull()
    expect((await run({ ...valid, zmax: undefined })).field).toBeNull()
    expect((await run({ ...valid, worldBounds: { min: [-200, -300, 0], max: [400, 300, 10] } })).field).toBeNull()
  })
})

describe('地面 pass 烘焙接入面（与 3D 档同源）', () => {
  it('走廊掩码单实现：类判据/足迹取样/mask 生成只在 groundPass，两侧只留宿主接线', () => {
    // 2026-10-14 用户报"轨道被下方地形遮挡"：烘焙此前未接入运行时的走廊细化机制
    // （正交俯视下遮挡同样取决于插值高度——细分级不只影响成本）
    expect(gpSrc).toMatch(/export function buildCorridorRefineMask\(\{ meshes, field, n, span, marginTexels = 2 \}\) \{/)
    expect(gpSrc).toMatch(/if \(box\.isEmpty\(\) \|\| box\.max\.y - box\.min\.y > 2\.5\) continue;/)
    expect(gpSrc).toMatch(/Math\.abs\(box\.min\.y - t\) <= 1\.0/)
    expect(gpSrc).toMatch(/const mask = buildRefineMask\(pts, n, span, marginTexels\);/)
    // 运行时：调用共享实现并把掩码喂进构建器（留宿主接线与 DEBUG 钩子）
    expect(mapAssetsSrc).toMatch(/const built = buildCorridorRefineMask\(\{/)
    expect(mapAssetsSrc).toMatch(/terrainRefineMask = built\.mask;/)
    expect(src).toMatch(/refineMask: terrainRefineMask,/)
    expect(src).toMatch(/terrainRefineMask = null;/)
    // 烘焙：同一实现 + 同一收集口径（onMesh 的 water 标记）；次序=掩码先于实例化合批
    expect(bakeSrc).toMatch(/buildCorridorRefineMask\(\{/)
    expect(bakeSrc).toMatch(/meshes: sceneryMeshes, field,/)
    expect(bakeSrc).toMatch(/onMesh: \(o, waterMarked\) => \{ sceneryMeshes\.push\(\{ o, water: waterMarked \}\); \},/)
    expect(bakeSrc).toMatch(/refineMask: corridor \? corridor\.mask : null,/)
    const maskAt = bakeSrc.indexOf('buildCorridorRefineMask(')
    const instAt = bakeSrc.indexOf('collectInstanceEntries(gltf.scene)')
    expect(maskAt).toBeGreaterThan(0)
    expect(instAt).toBeGreaterThan(maskAt)
    // 世界矩阵就绪（掩码按世界系取样）：掩码前必须有 updateMatrixWorld
    const wmAt = bakeSrc.indexOf('group.updateMatrixWorld(true)')
    expect(wmAt).toBeGreaterThan(0)
    expect(wmAt).toBeLessThan(maskAt)
  })

  it('地形数据来自 pack 的 terrain.json + 配对 bin；有效跨度取自愈后的 span', () => {
    expect(bakeSrc).toMatch(/binUrl: P \+ 'terrain\.u16\.bin', metaUrl: P \+ 'terrain\.json', fetchFn: \(u\) => fetch\(u\),/)
    expect(bakeSrc).toMatch(/const effSpan = \(tmeta && Number\.isFinite\(tmeta\.span\) && tmeta\.span > 0\) \? tmeta\.span : span/)
    expect(bakeSrc).toMatch(/groundMesh = new THREE\.Mesh\(buildGroundGeometry\(\{/)
    expect(bakeSrc).toMatch(/scene\.add\(groundMesh\)/)
  })

  it('水语义件保留渲染（keepWater）；"≥90% 图幅壳"几何剔除已删（运行时渲染件不得被剔）', () => {
    expect(bakeSrc).toMatch(/keepWater: true, skyFlagsAvailable \}\)\) drop\.push\(o\)/)
    // 2026-10-14 用户报"米尔德堡右上角黑块"后删除：该规则把运行时正常渲染的外圈山体/
    // 大地壳整块剔掉，露出可玩区外 colormap 暗色边带；真天空穹由 /sky/ 判据处理
    expect(bakeSrc).not.toMatch(/span \* 0\.9/)
    expect(bakeSrc).not.toMatch(/hasWater/)
  })

  it('装配实参：真实 groundLayers（贴花不复落 Lambert）+ 水面 waterCoast 同运行时', () => {
    // 烘焙页为 CRLF 行尾：跨行断言一律 \s*（\n\s* 会被 \r 卡住）
    expect(bakeSrc).toMatch(/assembleSceneryMaterials\(gltf, \{\s*strictSurfaces,\s*masks,\s*groundLayers,\s*waterCoast,/)
  })

  it('材质装配先于 qFrame 挂载（两侧同序；PR #621 review P2：水下判定按 GLB z-up 世界包围盒）', () => {
    // 源码顺序：运行时 assemble → mapScenery 挂载；烘焙 assemble → group 挂载 → 世界矩阵 → 走廊掩码
    const rtAsm = mapAssetsSrc.indexOf('assembleSceneryMaterials(gltf, {')
    expect(rtAsm).toBeGreaterThan(0)
    expect(mapAssetsSrc.indexOf('mapScenery.add(gltf.scene)')).toBeGreaterThan(rtAsm)
    const bkAsm = bakeSrc.indexOf('assembleSceneryMaterials(gltf, {')
    const bkMount = bakeSrc.indexOf('group.add(gltf.scene)')
    expect(bkAsm).toBeGreaterThan(0)
    expect(bkMount).toBeGreaterThan(bkAsm)
    expect(bakeSrc.indexOf('scene.add(group)')).toBeGreaterThan(bkAsm)
    expect(bakeSrc.indexOf('group.updateMatrixWorld(true)')).toBeGreaterThan(bkMount)
    expect(bakeSrc.indexOf('buildCorridorRefineMask({')).toBeGreaterThan(bakeSrc.indexOf('group.updateMatrixWorld(true)'))

    // 行为：z=10 水面下的 2 m 石块 → 水下不受光（MeshBasicMaterial）；z=10.2 水上薄板 → 常规 Lambert
    const NO_TEX = () => null
    const masks = { maskTexOf: NO_TEX, lmTexOf: NO_TEX, detailTexOf: NO_TEX, envTexOf: NO_TEX, waterTexOf: NO_TEX, decalTexOf: NO_TEX }
    const build = () => {
      const root = new THREE.Group()
      const waterMat = new THREE.MeshStandardMaterial({ name: 'water' })
      waterMat.userData.water = true
      const water = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), waterMat)
      water.position.set(0, 0, 10)
      const stone = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ name: 'stone' }))
      stone.position.set(0, 0, 8)
      const plank = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.1), new THREE.MeshStandardMaterial({ name: 'plank' }))
      plank.position.set(0, 0, 10.2)
      root.add(water, stone, plank)
      return { gltf: { scene: root }, stone, plank }
    }
    const qFrame = () => {
      const g = new THREE.Group()
      g.rotation.order = 'YXZ'
      g.rotation.set(-Math.PI / 2, Math.PI, 0)
      return g
    }
    // 现行顺序（两侧）：装配时 gltf.scene 尚未挂 qFrame
    const a = build()
    assembleSceneryMaterials(a.gltf, { strictSurfaces: true, masks })
    expect(a.stone.material.isMeshBasicMaterial).toBe(true)
    expect(a.plank.material.isMeshLambertMaterial).toBe(true)
    // 反例（锁住"顺序承重"）：先挂 qFrame 且组世界矩阵已更新 ⇒ 高度轴变成 y，水上/水下互换
    const b = build()
    const g = qFrame()
    g.add(b.gltf.scene)
    g.updateMatrixWorld(true)
    assembleSceneryMaterials(b.gltf, { strictSurfaces: true, masks })
    expect(b.stone.material.isMeshBasicMaterial).toBeFalsy()
    expect(b.plank.material.isMeshBasicMaterial).toBe(true)
  })

  it('新包 sky 标记在装配期打 userData.isSky（实例化过滤不再按名字猜）', () => {
    const NO_TEX = () => null
    const masks = { maskTexOf: NO_TEX, lmTexOf: NO_TEX, detailTexOf: NO_TEX, envTexOf: NO_TEX, waterTexOf: NO_TEX, decalTexOf: NO_TEX }
    const root = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({ name: 'skyobject_mat' })
    mat.userData.sky = true
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat)
    mesh.name = 'bld_x.sc2'   // 名字不含 sky：必须靠 extras 标记
    root.add(mesh)
    const r = assembleSceneryMaterials({ scene: root }, { strictSurfaces: true, masks })
    expect(r.skyMeshes).toBe(1)
    expect(mesh.userData.isSky).toBe(true)
    expect(mesh.frustumCulled).toBe(false)
  })

  it('多材质混合 sky 组整件走普通路径（不把普通 group 投到无限远）', () => {
    const NO_TEX = () => null
    const masks = { maskTexOf: NO_TEX, lmTexOf: NO_TEX, detailTexOf: NO_TEX, envTexOf: NO_TEX, waterTexOf: NO_TEX, decalTexOf: NO_TEX }
    const root = new THREE.Group()
    const skyMat = new THREE.MeshStandardMaterial({ name: 'skyobject' })
    skyMat.userData.sky = true
    const plainMat = new THREE.MeshStandardMaterial({ name: 'brick' })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [skyMat, plainMat])
    mesh.name = 'mixed'
    root.add(mesh)
    const r = assembleSceneryMaterials({ scene: root }, { strictSurfaces: true, masks })
    expect(r.skyMeshes).toBe(0)
    expect(mesh.userData.isSky).toBeUndefined()
  })

  it('显式 skyFlagsAvailable 时，未标记的 sky 名网格不得转天空（预剔除后重算回归）', () => {
    const NO_TEX = () => null
    const masks = { maskTexOf: NO_TEX, lmTexOf: NO_TEX, detailTexOf: NO_TEX, envTexOf: NO_TEX, waterTexOf: NO_TEX, decalTexOf: NO_TEX }
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'ordinary' }))
    mesh.name = 'sky_dome'   // 名字像天，但材质无 extras.sky
    root.add(mesh)
    const r = assembleSceneryMaterials({ scene: root }, { strictSurfaces: true, masks, skyFlagsAvailable: true })
    expect(r.skyMeshes).toBe(0)
    expect(mesh.userData.isSky).toBeUndefined()
  })

  it('meta 携带 ground 标志与有效跨度（合成器据 ground 以"覆盖即替换"口径合并）', () => {
    // 逐图产物生命周期（删旧产物 / .tmp→rename / meta 内容）在 scripts/bake-overhead-key.mjs，
    // 行为回归见 bake-overhead-key.test.mjs；CLI 只调用、不得复辟本地副本
    expect(bakeSrc).toMatch(/import \{ bakeKey \} from '\.\/bake-overhead-key\.mjs'/)
    expect(bakeSrc).not.toMatch(/async function bakeKey\(/)
    expect(bakeSrc).toMatch(/bakeKey\(\{ page, key, outDir, span: spans\[key\], size: SIZE,\s*mapId: primaryMapIdOf\(key\), uploadPath: UPLOAD \}\)/)
    expect(bakeSrc).toMatch(/writeFileSync\(UPLOAD, body\)/)
    expect(bakeSrc).toMatch(/return \{ ok: true, span: effSpan, ground: groundReady \}/)
    // 退化几何按 (ic/3)/vc 比率删除已撤除（同 3D 运行时；统计启发式不得复活）
    expect(bakeSrc).not.toMatch(/degenerate|\(ic \/ 3\) \/ vc > 15/)
  })

  it('Test C：ground=true 只来自分层地面网格建成（PR #621 blocker：缺层 → 白地面 → ground=true 覆盖 ground.webp）', () => {
    // 语义漂移禁令：ground 不得再等价于"有地形"
    expect(bakeSrc).not.toMatch(/ground: !!field/)
    // fail-closed：有地形即强制读取完整分层，读取失败直接冒泡（load reject → bakeKey 不写产物）；
    // 不得再有吞错退化分支
    expect(bakeSrc).toMatch(/if \(field\) \{\s*groundLayers = await loadBakeGroundLayers\(\{/)
    // 地形同样 fail-closed：terrain.json 读到（meta 有键）而 field=null ⇒ 抛出，且先于分层读取/出图
    // 地形配对按 loadTerrain 回报的 HTTP 事实判定（requireBakeTerrain，行为回归见 bake-ground-layers.test.js），
    // 不得再靠 meta 是否有键猜——json 404/缺字段时 loadTerrain 返回 field=null（bin 仍请求以记录事实）
    expect(bakeSrc).toMatch(/const \{ field, meta: tmeta, metaStatus, binStatus \} = await loadTerrain\(\{/)
    expect(bakeSrc).not.toMatch(/Object\.keys\(tmeta\)/)
    const terrainAt = bakeSrc.indexOf('requireBakeTerrain({ field, metaStatus, binStatus })')
    expect(terrainAt).toBeGreaterThan(bakeSrc.indexOf('await loadTerrain({'))
    expect(terrainAt).toBeLessThan(bakeSrc.indexOf('await loadBakeGroundLayers({'))
    expect(bakeSrc).not.toMatch(/if \(field\) try/)
    expect(bakeSrc).not.toMatch(/分层地表缺失/)
    // 烘焙侧没有回退底图：地面材质不得带 mapTexture（null = 纯白 MeshBasicMaterial），也不得
    // 以可空的 groundLayers 取层（"groundLayers && groundLayers.layers" 即会落回回退档）
    expect(bakeSrc).not.toMatch(/mapTexture/)
    expect(bakeSrc).not.toMatch(/groundLayers && groundLayers\./)
    expect(bakeSrc).toMatch(/makeGroundMaterial\(\{\s*layers: groundLayers\.layers, texs: groundLayers\.texs, size: effSpan,\s*\}\)/)
    // groundReady 唯一置真点：在地面网格入场景 + 分层着色自检之后
    expect(bakeSrc).toMatch(/let groundReady = false/)
    expect(bakeSrc.match(/groundReady = true/g)).toHaveLength(1)
    const addAt = bakeSrc.indexOf('scene.add(groundMesh)')
    const checkAt = bakeSrc.indexOf('if (!groundMesh.material.isShaderMaterial) throw new Error(')
    const readyAt = bakeSrc.indexOf('groundReady = true')
    expect(addAt).toBeGreaterThan(0)
    expect(checkAt).toBeGreaterThan(addAt)
    expect(readyAt).toBeGreaterThan(checkAt)
    // 逐图失败不改变批处理策略：bakeKey 抛出由主循环逐图 catch（输出 {key,error}，继续下一张）
    expect(bakeSrc).toMatch(/console\.log\(JSON\.stringify\(\{ key, error: String\(e\)\.slice\(0, 300\) \}\)\)/)
  })

  it('makeGroundMaterial 共享回退档不变：3D 运行时的真实 mapTexture 仍是合法回退（修复只落烘焙宿主）', () => {
    const mapTexture = new THREE.Texture()
    const fallback = makeGroundMaterial({ size: 600, mapTexture })
    expect(fallback.isMeshBasicMaterial).toBe(true)
    expect(fallback.map).toBe(mapTexture)
    expect(fallback.toneMapped).toBe(false)
    // 对照：烘焙若沿用 mapTexture:null 得到的就是无贴图纯白材质——正是 bake 必须拒绝的形态
    const white = makeGroundMaterial({ size: 600, mapTexture: null })
    expect(white.isMeshBasicMaterial).toBe(true)
    expect(white.map).toBeNull()
    expect(white.color.getHex()).toBe(0xffffff)
  })

  it('逐图资源生命周期：地面网格/分层贴图/海岸线纹理随换图释放', () => {
    expect(bakeSrc).toMatch(/if \(groundMesh\) \{ scene\.remove\(groundMesh\); groundMesh\.geometry\.dispose\(\); groundMesh\.material\.dispose\(\); groundMesh = null \}/)
    expect(bakeSrc).toMatch(/if \(groundTexs\) \{ for \(const k in groundTexs\) groundTexs\[k\]\?\.dispose\?\.\(\); groundTexs = null \}/)
    expect(bakeSrc).toMatch(/if \(waterCoastTex\) \{ waterCoastTex\.dispose\(\); waterCoastTex = null \}/)
  })
})
