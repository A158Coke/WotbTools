// 地面 pass SSOT 守卫（src/scene/groundPass.js；2026-10-14 抽层，用户裁示"直接完全照搬
// 3D 回放的代码接入渲染"）：
//   ① 地形数据/几何、分层地表材质、水面海岸线资源只有一处实现——3D 运行时（playbackScene）
//      与俯视烘焙（scripts/bake-ground-overhead.mjs）两侧消费同一模块，本地不得复辟副本；
//   ② 烘焙接入面完整：terrain.json/bin → loadTerrain；ground.layers.json → groundLayerKeys/
//      setupGroundTextures；地面网格/材质进场景；水件保留（keepWater）并入装配；meta 携带
//      ground 标志（合成器据它以"覆盖即替换"口径合并，tools/composite_overhead.py）。
// 背景：抽层前烘焙不渲染地面——底图是客户端自带地图图（ground.webp），与 3D 档的实时分层
// 渲染（cm×lm×tile/mask）在夜图/带 lm 图上差异显著（faust 用户报障"webp 与 3D 俯视图差
// 别大"的直接来源）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const gpSrc = strip(readFileSync(resolve(here, 'groundPass.js'), 'utf8'))
const src = strip(readFileSync(resolve(here, 'playbackScene.js'), 'utf8'))
const bakeSrc = strip(readFileSync(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'), 'utf8'))

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
    expect(src).toMatch(/waterCoast = makeWaterCoast\(\{/)
    expect(src).toMatch(/const need = groundLayerKeys\(L\);/)
    expect(src).toMatch(/setupGroundTextures\(texs, ani\);/)
    expect(src).toMatch(/const \{ field, meta: tmeta \} = await loadTerrain\(\{/)
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
    expect(bakeSrc).toMatch(/groundLayerKeys\(L\)/)
    expect(bakeSrc).toMatch(/setupGroundTextures\(texs,/)
    expect(bakeSrc).toMatch(/buildGroundGeometry\(\{/)
    expect(bakeSrc).toMatch(/makeGroundMaterial\(\{/)
    expect(bakeSrc).toMatch(/makeWaterCoast\(\{/)
    expect(bakeSrc).not.toMatch(/function groundShaderMaterial/)
    expect(bakeSrc).not.toMatch(/uniform sampler2D uCM;/)
    expect(bakeSrc).not.toMatch(/function decodeTerrainField/)
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

describe('地面 pass 烘焙接入面（与 3D 档同源）', () => {
  it('走廊掩码单实现：类判据/足迹取样/mask 生成只在 groundPass，两侧只留宿主接线', () => {
    // 2026-10-14 用户报"轨道被下方地形遮挡"：烘焙此前未接入运行时的走廊细化机制
    // （正交俯视下遮挡同样取决于插值高度——细分级不只影响成本）
    expect(gpSrc).toMatch(/export function buildCorridorRefineMask\(\{ meshes, field, n, span, marginTexels = 2 \}\) \{/)
    expect(gpSrc).toMatch(/if \(box\.isEmpty\(\) \|\| box\.max\.y - box\.min\.y > 2\.5\) continue;/)
    expect(gpSrc).toMatch(/Math\.abs\(box\.min\.y - t\) <= 1\.0/)
    expect(gpSrc).toMatch(/const mask = buildRefineMask\(pts, n, span, marginTexels\);/)
    // 运行时：调用共享实现并把掩码喂进构建器（留宿主接线与 DEBUG 钩子）
    expect(src).toMatch(/const built = buildCorridorRefineMask\(\{/)
    expect(src).toMatch(/terrainRefineMask = built\.mask;/)
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
    expect(bakeSrc).toMatch(/keepWater: true \}\)\) drop\.push\(o\)/)
    // 2026-10-14 用户报"米尔德堡右上角黑块"后删除：该规则把运行时正常渲染的外圈山体/
    // 大地壳整块剔掉，露出可玩区外 colormap 暗色边带；真天空穹由 /sky/ 判据处理
    expect(bakeSrc).not.toMatch(/span \* 0\.9/)
    expect(bakeSrc).not.toMatch(/hasWater/)
  })

  it('装配实参：真实 groundLayers（贴花不复落 Lambert）+ 水面 waterCoast 同运行时', () => {
    // 烘焙页为 CRLF 行尾：跨行断言一律 \s*（\n\s* 会被 \r 卡住）
    expect(bakeSrc).toMatch(/assembleSceneryMaterials\(gltf, \{\s*strictSurfaces,\s*masks,\s*groundLayers,\s*waterCoast,/)
  })

  it('meta 携带 ground 标志与有效跨度（合成器据 ground 以"覆盖即替换"口径合并）', () => {
    expect(bakeSrc).toMatch(/JSON\.stringify\(\{ key, span: spanEff, size: SIZE, ground: !!\(load && load\.ground\), \.\.\.stats \}\)/)
    expect(bakeSrc).toMatch(/return \{ ok: true, degenerate: degenerate\.length, span: effSpan, ground: !!field \}/)
  })

  it('逐图资源生命周期：地面网格/分层贴图/海岸线纹理随换图释放', () => {
    expect(bakeSrc).toMatch(/if \(groundMesh\) \{ scene\.remove\(groundMesh\); groundMesh\.geometry\.dispose\(\); groundMesh\.material\.dispose\(\); groundMesh = null \}/)
    expect(bakeSrc).toMatch(/if \(groundTexs\) \{ for \(const k in groundTexs\) groundTexs\[k\]\?\.dispose\?\.\(\); groundTexs = null \}/)
    expect(bakeSrc).toMatch(/if \(waterCoastTex\) \{ waterCoastTex\.dispose\(\); waterCoastTex = null \}/)
  })
})
