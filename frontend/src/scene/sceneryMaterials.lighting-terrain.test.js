import { describe, it, expect } from 'vitest'
import { playbackSceneSource } from './__tests__/sceneSource.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const readSrc = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const src = playbackSceneSource()
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const rendererSrc = readSrc(resolve(here, 'playback/renderer.ts'), 'utf8')
const mapAssetsSrc = readSrc(resolve(here, 'playback/mapAssets.ts'), 'utf8')
const matSrc = ['sceneryMaterials.ts', 'sceneryLightingMaterials.ts', 'sceneryWaterMaterials.ts', 'scenerySurfaceMaterials.ts'].map(path => readSrc(resolve(here, path), 'utf8')).join('\n')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const asmSrc = readSrc(resolve(here, 'sceneryAssembly.ts'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const gpSrc = readSrc(resolve(here, 'groundPass.js'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const mapWorldSrc = ['playback/mapWorld.ts', 'playback/mapWorldLoader.ts', 'playback/mapWorldTerrain.ts'].map(path => stripComments(readSrc(resolve(here, path)))).join('\n')
const vehSrc = stripComments(readSrc(resolve(here, 'playback/vehicleRuntime.ts')))

describe('照明与地形材质合同', () => {


  it('逐图太阳宿主接线（#827 F3：无注入点）：target 入场景图、会话拆除复位', () => {
    expect(rendererSrc).toMatch(/scene\.add\(sunLight\.target\);/)
    expect(src).toMatch(/mapWorld\.resetMapLighting\(\);/)
  })




  it('ST| 静态几何走伽马直通 ShaderMaterial（与叶卡同方程，防同树双色）', () => {
    const st = asmSrc.slice(asmSrc.indexOf("if ((m.name || '').startsWith('ST|'))"))
    expect(st.slice(0, 400)).toMatch(/return makeSpeedtreeStaticMaterial\(m, opaqueEnough\);/)
    const fn = matSrc.slice(matSrc.indexOf('function makeSpeedtreeStaticMaterial'))
    expect(fn).toMatch(/gl_FragColor = vec4\(c\.rgb \* \(vOcc \* uSH\), c\.a \* uOpacity\);/)
    expect(fn).toMatch(/uAlphaCut: \{ value: blend \? 0\.05 : 0\.33 \}/)
    expect(fn).toMatch(/transparent: blend,/)
    expect(fn).toMatch(/depthWrite: !blend,/)
    expect(fn).toMatch(/vOcc = \$\{hasVC \? 'color\.r' : '1\.0'\};/)
    expect(fn).toMatch(/new THREE\.Vector3\(c0\.r, c0\.g, c0\.b\)/)
  })



  it('坦克环境光隔离：清零 three 的环境/半球 irradiance、保留 IBL 与直接光', () => {
    const at = matSrc.indexOf('export function patchTankMaterial');
    expect(at).toBeGreaterThan(-1)
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10))
    expect(fn).toMatch(/#include <lights_fragment_begin>/)
    expect(fn).toMatch(/irradiance = vec3\( 0\.0 \);/)
    expect(fn).toMatch(/'\|tank-noambient'/)
    expect(vehSrc).toMatch(/v\.glbVisual = prepareTankDestroyedVisual\(v\.glb\);/)
  })



  it('出屏口径（A2）：线性 × 曝光 1.0 → sRGB 编码 = 客户端口径；不引入调参旋钮（#827 F3: Integration Contract（无注入点）：createSceneCore 需真实 WebGLRenderer，无法 headless 行为化）', () => {
    expect(rendererSrc).toMatch(/renderer\.toneMapping = THREE\.LinearToneMapping;/)
    expect(rendererSrc).toMatch(/renderer\.toneMappingExposure = 1\.0;/)
    expect(src).not.toMatch(/get\('tonemap'\)|get\('exposure'\)/)
    expect(rendererSrc).not.toMatch(/ACESFilmicToneMapping/)
  })



  it('内联着色器的 varying 必须在**该段**声明（地面着色器是内联字符串，漏声明=整材质不画）', () => {
    const at = gpSrc.indexOf('uniform sampler2D uCM;')
    expect(at).toBeGreaterThan(-1)
    const frag = gpSrc.slice(at, gpSrc.indexOf('`', at))
    const declPart = frag.slice(0, frag.indexOf('void main()'))
    const decls = new Set([...declPart.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]))
    expect(decls.has('vXZ')).toBe(true)
    const used = new Set([...frag.matchAll(/\bv[A-Z]\w*/g)].map((m) => m[0]))
    for (const name of used) {
      expect(decls.has(name), `地面片元用到 ${name} 但未声明`).toBe(true)
    }
    const vat = gpSrc.indexOf('uniform vec4 uHbSoft;')
    expect(vat).toBeGreaterThan(-1)
    expect(src).not.toMatch(/uniform sampler2D uCM;/)
    expect(src).not.toMatch(/uniform vec4 uHbSoft;/)
  })



  it('采样空间（C3）：自定义材质一律原样采样；SRGB 解码只许出现在显示内容链', () => {
    expect(matSrc).not.toMatch(/SRGBColorSpace/);
    expect(matSrc).toMatch(/NoColorSpace/);
    expect(mapWorldSrc).toMatch(/st\.groundLayers = \{ layers: L, texs \};/)
    expect(mapWorldSrc.replace('st.groundLayers = { layers: L, texs };', '')).not.toMatch(/st\.groundLayers = \{ layers: L, texs \};/)
    expect(mapWorldSrc).not.toMatch(/texs\[k\][^\n]*colorSpace/);
  })



  it('地面弹着痕迹（D2）已撤除：客户端贴图不在可得数据面 ⇒ 不留程序化替代', () => {
    expect(src).not.toMatch(/impactDecals|stampGroundScar|DECALS_ON|makeScorchMaterial/)
    expect(src).not.toMatch(/get\('decals'\)/)
  })



  it('地形客户端同构：K 余量（负面守卫 + 唯一高度场）——构建/LOD 行为已由 terrainMesh.test.js 与 mapWorld.lifecycle.test.ts 接替', () => {
    expect(mapWorldSrc).not.toMatch(/new THREE\.PlaneGeometry\(size, size, Q\.terrainSeg/)
    expect(mapWorldSrc).not.toMatch(/setZ\(k, sampleHeight\(-pos\.getX\(k\)/)
    expect(mapWorldSrc).not.toMatch(/scenerySeamLift|instanceSeamLift|TERRAIN_SEAM_BAND/)
    expect(mapWorldSrc).not.toMatch(/get\('poff'\)|get\('seamfix'\)|get\('terrainlod'\)/)
    expect(mapWorldSrc).not.toMatch(/applyTerrainCover|terrainCover/)
    expect(mapWorldSrc).not.toMatch(/renderField/)
    expect(mapWorldSrc).not.toMatch(/structFootprint|structs\.u8\.bin/)
    const shAt = mapWorldSrc.indexOf('function sampleHeight')
    expect(shAt).toBeGreaterThan(-1)
    const shBody = mapWorldSrc.slice(shAt, mapWorldSrc.indexOf('function ', shAt + 10))
    expect(shBody).toMatch(/heightField/)
  })




  it('贴花材质（客户端 MATERIAL_DECAL）：UV1 采 colormap、不受光、×2.0，且接线在受光兜底之前', () => {
    const decalSrc = matSrc.slice(matSrc.indexOf('export function makeDecalMaterial'),
                                  matSrc.indexOf('export function makeWaterMaterial'))
    expect(decalSrc.length).toBeGreaterThan(500)
    expect(decalSrc).toMatch(/vUv1 = uv1;/)
    expect(decalSrc).toMatch(/vec3 decalRgb = texture2D\(colormap, vUv1\)\.rgb;/)
    expect(decalSrc).toMatch(/shadowColor \*= texture2D\(colormapLm, vUv1\)\.r;/)
    expect(decalSrc).toMatch(/gl_FragColor = vec4\(base\.rgb \* uTint \* shadowColor \* 2\.0, 1\.0\);/)
    expect(decalSrc).not.toMatch(/uSunDirScene|uSunColor/)
    expect(decalSrc).toMatch(/decalRgb = pow\(decalRgb, vec3\(uLmAdjust\.z\)\);/)
    expect(decalSrc).toMatch(/decalRgb = \(decalRgb - 0\.5\) \* uLmAdjust\.y \+ 0\.5;/)
    expect(decalSrc).toMatch(/decalRgb \+= uLmAdjust\.x;/)
    expect(decalSrc).toMatch(/#include <logdepthbuf_fragment>/)
  })



  it('共面接缝不做人工补偿（客户端无深度偏移、数据同样共面；2026-10-10 撤掉 ?poff 与 ?seamfix）', () => {
    expect(src).not.toMatch(/sceneryOffsetMats|applySceneryOffset|POFF_UNITS|POFF_REF_DIST/)
    expect(src).not.toMatch(/polygonOffsetUnits = -units/)
  })



  it('禁止按逐网格三角形/顶点比删几何（统计启发式；损坏应由导出器语义标记/报错）', () => {
    expect(src).not.toMatch(/degradedMeshes/)
    expect(src).not.toMatch(/degLimit/)
    expect(src).not.toMatch(/location\.search\)\.get\('degrade'\)/)
  })



  it('视角淡出效果片（AlphaBlend + BLEND_BY_ANGLE）：软混合 + 客户端视角因子，不被裁切', () => {
    const at = matSrc.indexOf('export function makeBlendByAngleMaterial');
    expect(at).toBeGreaterThan(-1);
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10));
    expect(fn).toMatch(/float VdotN = abs\(dot\(V, N\)\);/);
    expect(fn).toMatch(/VdotN = mix\(VdotN, 1\.0 - VdotN, uInversion\);/);
    expect(fn).toMatch(/float ang = clamp\(\(VdotN - uBounds\.x\) \/ max\(uBounds\.y - uBounds\.x, 1e-6\), 0\.0, 1\.0\);/);
    expect(fn).toMatch(/gl_FragColor = vec4\(c\.rgb, c\.a \* pow\(ang, uPower\)\);/);
    expect(fn).toMatch(/transparent: true,/);
    expect(fn).toMatch(/depthWrite: false,/);
  })



  it('水面"海岸线"coastLine：按客户端 water-fp.sl 的相对深度差口径淡出反射（距离无关、随相机高低自适应）', () => {
    expect(asmSrc).toMatch(/coast: waterCoast, wro: ud\.water,/)
    expect(mapWorldSrc).toMatch(/if \(st\.waterTexDispose\) \{ st\.waterTexDispose\.dispose\(\); st\.waterTexDispose = null; \}/)
    expect(mapWorldSrc).toMatch(/function terrainSpanOf\(\) \{/)
    expect(mapWorldSrc).not.toMatch(/terrainCellBound\(1, camera/)
    const wSrc = ['sceneryMaterials.ts', 'sceneryLightingMaterials.ts', 'sceneryWaterMaterials.ts', 'scenerySurfaceMaterials.ts'].map(path => readSrc(resolve(here, path), 'utf8')).join('\n')
    expect(wSrc).toMatch(/export function makeWaterMaterial\(m: GltfSceneMaterial, \{ normalTex, cubeTex, props, coast = null, wro = null \}: \{/)
    expect(wSrc).toMatch(/uniform sampler2D uHeightmap;/)
    expect(wSrc).toMatch(/float dNdcZ = \(2\.0 \* uFar \* uNear \/ \(\(uFar - uNear\) \* zlen \* zlen\)\) \* dzAlong;/)
    expect(wSrc).toMatch(/float byDepth = clamp\(dNdcZ \/ \(2\.0 \* uDepthUlp\), 0\.0, 1\.0\);/)
    expect(wSrc).toMatch(/float byWorld = smoothstep\(0\.0, uCoastFade, dzWorld\);/)
    expect(wSrc).toMatch(/coastLine = min\(byDepth, byWorld\);/)
    expect(wSrc).toMatch(/float dzWorld = vWorldP\.y - terrainY;/)
    expect(wSrc).toMatch(/float dzAlong = dzWorld \/ max\(abs\(toCam\.y\) \/ zlen, 1e-3\);/)
    expect(wSrc).toMatch(/float terrainY = texture2D\(uHeightmap, vWorldP\.xz \/ uMapSpan \+ 0\.5 \+ 0\.5 \* uHmTexel\)\.r;/)
    expect(wSrc).toMatch(/uHmTexel: \{ value: \(\(\) => \{[\s\S]*?img\.width > 0 \? 1 \/ img\.width : 0\s*\}\)\(\) \},/)
    expect(gpSrc).toMatch(/const matched = await terrainBinMatchesMeta\(tbuf, meta\);[\s\S]*?if \(matched\) \{[\s\S]*?decodeTerrainField\(tbuf, meta\)/)
    expect(mapWorldSrc).toMatch(/fetchFn: \(u: string\) => assetProvider\.fetch\(u\),/)
    expect(gpSrc).toMatch(/fetchFn\(pairedTerrainBinUrl\(binUrl, meta\)\)/)
    expect(gpSrc).toMatch(/const matched = await terrainBinMatchesMeta\(tbuf, meta\)/)
    expect(mapWorldSrc).not.toMatch(/heightField\[i\] = u16\[i\]/)
    expect(wSrc).toMatch(/float alpha = max\(clamp\(fresnel, 0\.0, 1\.0\), uMinAlpha\) \* coastLine;/)
    expect(wSrc).toMatch(/uMinAlpha: \{ value: 0\.32 \},/)
    expect(wSrc).not.toMatch(/uCoastCellPerDist|cellPerDist/)
    expect(wSrc).not.toMatch(/max\(cameraPosition\.y - vWorldP\.y, 1e-3\)/)
  })



  it('水下静态件不接光照图：按客户端折射通道口径（VIEW_DIFFUSE=0 ⇒ albedo，不受光、不乘 2）', () => {
    expect(asmSrc).toMatch(/export function collectWaterSurfaces\(root: Object3D\): WaterSurfaceFootprint\[\] \{\n\s*root\.updateMatrixWorld\(true\);\n\s*const waterSurfaces: WaterSurfaceFootprint\[\] = \[\];/)
    expect(asmSrc).toMatch(/export function makeUnderWater\(waterSurfaces: readonly WaterSurfaceFootprint\[\]\): \(o: Mesh\) => boolean \{\n\s*return \(o\) => \{/)
    expect(asmSrc).toMatch(/bb\.max\.z <= w\.h \+ 0\.05\) return true;/)
    expect(asmSrc).toMatch(/const uw = !!o\.geometry && underWater\(o\);/)
    expect(asmSrc).toMatch(/if \(ud\.lightmap !== undefined && !isWaterNode\(o\.name, m, \{ strictSurfaces \}\)\s*\n\s*&& !isSkyNode\(o\) && !underWater\(o\)\) \{/)
    expect(asmSrc).toMatch(/if \(uw\) \{/)
    expect(asmSrc).toMatch(/new THREE\.MeshBasicMaterial\(\{/)
    expect(asmSrc).toMatch(/map: m\.map \|\| null,/)
    expect(asmSrc).not.toMatch(/underWater\(o\) \|\| true/)
    expect(mapAssetsSrc).toMatch(/assembleSceneryMaterials\(gltf, \{/)
    expect(mapAssetsSrc).toMatch(/groundLayers, waterCoast, debug: DEBUG,/)
  })



  it('细分判据回到客户端三条：playbackScene 不再计算/传递岸线标高表（第四条判据 2026-10-11 评审删除）', () => {
    expect(mapWorldSrc).not.toMatch(/shores:/)
    expect(mapWorldSrc).not.toMatch(/shoreLevels/)
    const meshSrc = readSrc(resolve(here, 'terrainMesh.js'), 'utf8')
    expect(meshSrc).not.toMatch(/shores/)
    expect(meshSrc).not.toMatch(/shoreHit/)
    const gdSrc = readSrc(resolve(here, 'groundGeometryData.ts'), 'utf8')
    expect(gdSrc).toMatch(/buildAdaptiveTerrain\(\{/)
    expect(mapWorldSrc).toMatch(/buildGroundGeometryTyped\(\{/)
  })



  it('地面分层混合 uniform 类型对齐：uHbSoft 必须 vec4（曾误写 float ⇒ 值 NaN ⇒ 地面取错层色）', () => {
    expect(gpSrc).toMatch(/uniform vec4 uHbSoft;/)
    expect(gpSrc).not.toMatch(/uniform float uHbSoft;/)
  })



  it('逐图光照亮度归一：保留方向/色相，曝光 = 基准太阳强度 / 该图太阳强度（模拟客户端自动曝光）', () => {
    expect(rendererSrc).toMatch(/renderer\.toneMapping = THREE\.LinearToneMapping;/)
  })



  it('水体：透明面写深度 + 双面 + 不设 renderOrder', () => {
    expect(matSrc).toMatch(/const isWaterName = \(n: string \| null \| undefined\): boolean => \/water\|sea\|lake\|river\|fountain\/i\.test\(n \|\| ''\);/)
    expect(mapAssetsSrc).toMatch(/import \{[^}]*isWaterNode as isWaterNodeRule[^}]*\} from '\.\.\/sceneryAssemblyRules\.js'/)
    expect(mapAssetsSrc).toMatch(/const strictSurfaces = strictSurfacesOf\(gltf\.scene\);/)
    expect(mapAssetsSrc).toMatch(/const isWaterNode = \(name: string, mat: import\('\.\.\/sceneryAssemblyRules\.js'\)\.SurfaceMaterial \| null \| undefined\) =>\n    isWaterNodeRule\(name, mat, \{ strictSurfaces \}\);/)
    expect(mapAssetsSrc).toMatch(/!\(e\.node\.userData && e\.node\.userData\.isSky\)[\s\S]{0,120}!isWaterNode\(e\.name, e\.material\)[\s\S]{0,120}!hasTransparentMaterial\(e\.material\)/)
    expect(asmSrc).toMatch(/o\.userData\.isSky = true;/)
    const skyFlagAt = mapAssetsSrc.indexOf('const skyFlagsAvailable = sceneHasSkyFlags(gltf.scene)')
    const pruneAt = mapAssetsSrc.indexOf('pruneForeignVariantsDetailed(gltf.scene')
    expect(skyFlagAt).toBeGreaterThan(-1)
    expect(pruneAt).toBeGreaterThan(skyFlagAt)
    expect(mapAssetsSrc).toMatch(/assembleSceneryMaterials\(gltf, \{[\s\S]{0,500}skyFlagsAvailable,/)
  })
})
