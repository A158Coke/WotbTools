import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const readSrc = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const src = readSrc(resolve(here, 'playbackScene.js'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const rendererSrc = readSrc(resolve(here, 'playback/renderer.ts'), 'utf8')
const mapAssetsSrc = readSrc(resolve(here, 'playback/mapAssets.ts'), 'utf8')
const matSrc = readSrc(resolve(here, 'sceneryMaterials.ts'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const asmSrc = readSrc(resolve(here, 'sceneryAssembly.ts'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const gpSrc = readSrc(resolve(here, 'groundPass.js'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const mapWorldSrc = stripComments(readSrc(resolve(here, 'playback/mapWorld.ts')))
const vehSrc = stripComments(readSrc(resolve(here, 'playback/vehicleRuntime.ts')))

describe('照明与地形材质合同', () => {


  it('逐图太阳宿主接线（#827 F3：无注入点）：target 入场景图、会话拆除复位', () => {
    // 应用/回退语义 2026-11-12 接替：mapLighting.test.js（applyMapLightingCore）+
    // mapWorld.behavior.test.ts（lighting.json 驱动方向/强度/环境色、缺失回落兜底）
    expect(rendererSrc).toMatch(/scene\.add\(sunLight\.target\);/)
    expect(src).toMatch(/mapWorld\.resetMapLighting\(\);/)
  })




  it('ST| 静态几何走伽马直通 ShaderMaterial（与叶卡同方程，防同树双色）', () => {
    // 回归：MeshBasicMaterial 的 sRGB 解码→编码往返把 SH 实际压成 SH^(1/2.2)，
    // 与 billboard 叶（直通）差约 28% → 同树固定叶/billboard 叶双色（erlenberg 实测）
    const st = asmSrc.slice(asmSrc.indexOf("if ((m.name || '').startsWith('ST|'))"))
    expect(st.slice(0, 400)).toMatch(/return makeSpeedtreeStaticMaterial\(m, opaqueEnough\);/)
    const fn = matSrc.slice(matSrc.indexOf('function makeSpeedtreeStaticMaterial'))
    // 客户端同式：albedo × vOcc × SH(L0)，伽马直采直写（无 tone mapping/输出重编码）
    expect(fn).toMatch(/gl_FragColor = vec4\(c\.rgb \* \(vOcc \* uSH\), c\.a \* uOpacity\);/)
    expect(fn).toMatch(/uAlphaCut: \{ value: blend \? 0\.05 : 0\.33 \}/)
    expect(fn).toMatch(/transparent: blend,/)
    expect(fn).toMatch(/depthWrite: !blend,/)
    // vOcc 仅取 COLOR_0.r（灰度遮挡）；无 COLOR_0 的正则树干 = 1
    expect(fn).toMatch(/vOcc = \$\{hasVC \? 'color\.r' : '1\.0'\};/)
    // SH 染色逐通道来自 baseColorFactor（karelia 彩色环境/√π 灰均按字面）
    expect(fn).toMatch(/new THREE\.Vector3\(c0\.r, c0\.g, c0\.b\)/)
  })



  it('坦克环境光隔离：清零 three 的环境/半球 irradiance、保留 IBL 与直接光', () => {
    // 客户端坦克（BlinnPhongAllQualities 模板 → ULTRA = PBR.material）的环境项只有 IBL
    // 立方图（pbr-lighting.slh 逐行）；我们额外挂的 HemisphereLight 会与 IBL 叠加 ⇒ 偏亮。
    // three 的 chunk 顺序是"irradiance（ambient/hemi）在 lights_fragment_begin、IBL 在
    // lights_fragment_end 才并入"，故在 begin 之后清零只去重、不动 IBL——顺序若变，
    // 本守卫与门禁（编译）会一起报警。
    const at = matSrc.indexOf('export function patchTankMaterial');
    expect(at).toBeGreaterThan(-1)
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10))
    expect(fn).toMatch(/#include <lights_fragment_begin>/)
    expect(fn).toMatch(/irradiance = vec3\( 0\.0 \);/)
    // 幂等/envMapIntensity 行为半句 2026-11-12 接替：sceneryMaterials.materials.test.ts
    //（patchTankMaterial 两次幂等 + envMapIntensity=TANK_ENV_INTENSITY）
    expect(fn).toMatch(/'\|tank-noambient'/)                       // 程序缓存键带标记（否则复用未打补丁程序）
    // 接线：坦克装配点（禁区外）调用；不改 scenery 侧任何材质
    expect(vehSrc).toMatch(/v\.glbVisual = prepareTankDestroyedVisual\(v\.glb\);/)
  })



  it('出屏口径（A2）：线性 × 曝光 1.0 → sRGB 编码 = 客户端口径；不引入调参旋钮（#827 F3: Integration Contract（无注入点）：createSceneCore 需真实 WebGLRenderer，无法 headless 行为化）', () => {
    // 客户端证据（tmp_analysis/shaders 逐行核过）：pbr-fp.sl 的 Uncharted2/Hejl 两条 filmic
    // 曲线都注释掉，生效行是注释写着 "Linear to sRGB conversion without tonemapping" 的
    // LinearToSRGB；exposure-tonemapping-fp.sl 的 `1 - exp(-x*e)` 同样注释掉，生效行是
    // `x * exposure`（线性 × 曝光）。⇒ 只允许线性档。
    expect(rendererSrc).toMatch(/renderer\.toneMapping = THREE\.LinearToneMapping;/)
    expect(rendererSrc).toMatch(/renderer\.toneMappingExposure = 1\.0;/)
    // 客户端的曝光是**屏幕级自动曝光**（`[auto] property float exposure`），数据面没有静态值可抄
    // ⇒ 不许引入 `?tonemap`/`?exposure` 这类"必须手工调才对"的替代参数（2026-10-10 撤除）。
    expect(src).not.toMatch(/get\('tonemap'\)|get\('exposure'\)/)
    expect(rendererSrc).not.toMatch(/ACESFilmicToneMapping/)
  })



  it('内联着色器的 varying 必须在**该段**声明（地面着色器是内联字符串，漏声明=整材质不画）', () => {
    // 地面着色器以内联字符串给出（2026-10-14 起在共享模块 groundPass.js），
    // 且顶点/片元两段各自独立声明 varying——只写不声明/只声明不写都会让整材质编译失败，
    // 页面上只表现为"地形整片不渲染"（2026-10-09 实测踩过）。故做"用到即声明"检查：
    // 片元里出现的 vXxx 标识符都必须在**片元自己的**声明段里。
    const at = gpSrc.indexOf('uniform sampler2D uCM;')
    expect(at).toBeGreaterThan(-1)
    const frag = gpSrc.slice(at, gpSrc.indexOf('`', at))
    const declPart = frag.slice(0, frag.indexOf('void main()'))
    const decls = new Set([...declPart.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]))
    expect(decls.has('vXZ')).toBe(true)              // 地面片元真实用到的 varying
    const used = new Set([...frag.matchAll(/\bv[A-Z]\w*/g)].map((m) => m[0]))
    for (const name of used) {
      expect(decls.has(name), `地面片元用到 ${name} 但未声明`).toBe(true)
    }
    // 顶点段同样声明（link 契约）；运行时侧不得再内联地面着色器（单实现守卫）
    const vat = gpSrc.indexOf('uniform vec4 uHbSoft;')   // 地面顶点段附近（类型见下方类型对齐守卫）
    expect(vat).toBeGreaterThan(-1)
    expect(src).not.toMatch(/uniform sampler2D uCM;/)
    expect(src).not.toMatch(/uniform vec4 uHbSoft;/)
  })



  it('采样空间（C3）：自定义材质一律原样采样；SRGB 解码只许出现在显示内容链', () => {
    // 客户端证据（2026-10-09 实测 DDS 头 + 着色器）：
    //  · PBR 类：albedo 槽带 **DXGI `*_UNORM_SRGB`**（实测 Maus 的 `_BC` = BC1_UNORM_SRGB，
    //    数据槽 NM/RM/MISC/MASK = legacy DXT 无标志）⇒ 硬件 sRGB 解码 → 线性运算 →
    //    `pbr-fp.sl` 末尾显式 `LinearToSRGB` 出屏（filmic 曲线注释掉）；
    //  · legacy 类（`Textured.material` = materials-fp、tilemask 非 PBR、water-fp、SpeedTree）：
    //    贴图全为 legacy DXT（无 sRGB 变体，实测 landscape.dds = DXT3、colormap = DXT5、
    //    老式坦克 albedo = DXT5）⇒ **原样采样、显示空间运算、raw 写出**（全文无编码调用；
    //    引擎的转换都是逐 pass 显式属性，如 cubemap-mipmap-copy 的 convertSRGBToLinear）。
    //  ⇒ 我们对 legacy 类的复刻（地面/布景/水面/叶卡/天空/效果片）必须原样采样（NoColorSpace），
    //    坦克走 GLTFLoader 的 sRGB 解码（对齐 PBR 类）——两类不得互相串。
    // 回归含义：给任一自定义材质加上 sRGB 解码（如给地面分层纹理设 SRGB）会让该材质
    // 「先解码再按显示空间运算」= 整体压暗，且只在部分材质上出现、难定位。
    expect(matSrc).not.toMatch(/SRGBColorSpace/);      // 材质模块内零 sRGB 解码
    expect(matSrc).toMatch(/NoColorSpace/);            // 且确有显式原样采样
    // 显示内容计数子句（恰好 4 处）2026-11-12 重构为各 owner 行为断言：
    //  · 叶卡/自定义材质原样采样 → sceneryMaterials.materials.test.ts（map → NoColorSpace）
    //  · 基地标记画布 SRGB → sceneryMaterials.materials.test.ts + markers.toneMapped.test.ts
    //  · IBL envTexture Equirect+SRGB → mapWorld.behavior.test.ts
    //  · 履带印贴图 → treadRuntime.behavior.test.ts 侧共享贴图（显示内容解码）
    // 新增一处 sRGB 解码必须先想清楚它属于哪一类。
    expect(mapWorldSrc).toMatch(/groundLayers = \{ layers: L, texs \};/)   // 分层纹理键集不变
    expect(mapWorldSrc).not.toMatch(/texs\[k\][^\n]*colorSpace/);          // 分层纹理不得改采样空间
  })



  it('地面弹着痕迹（D2）已撤除：客户端贴图不在可得数据面 ⇒ 不留程序化替代', () => {
    // 客户端该效果 = FX 粒子（FX/hit_surface 的 8 发射器）+ 游戏层 geo-decal，**贴图由游戏层传入、
    // 不在可得数据面** ⇒ 没有可对齐的实现；程序化画布 + 猜测尺寸/上限属"没有客户端依据"的改动，
    // 2026-10-10 按该原则撤除（要重做需先拿到客户端贴图）。此断言防其悄悄复活。
    expect(src).not.toMatch(/impactDecals|stampGroundScar|DECALS_ON|makeScorchMaterial/)
    expect(src).not.toMatch(/get\('decals'\)/)
  })



  it('地形客户端同构：K 余量（负面守卫 + 唯一高度场）——构建/LOD 行为已由 terrainMesh.test.js 与 mapWorld.lifecycle.test.ts 接替', () => {
    // 行为半句（buildAdaptiveTerrain/走廊掩码/morph/texel 原位、LOD 迟滞/原位旋转重建）
    // 2026-11-12 接替：terrainMesh.test.js（构建判据/掩码/morph 纯函数行为）+
    // mapWorld.lifecycle.test.ts（maybeRebuildTerrainLod 原位旋转重建、滞回窗口不重建）
    expect(mapWorldSrc).not.toMatch(/new THREE\.PlaneGeometry\(size, size, Q\.terrainSeg/)
    expect(mapWorldSrc).not.toMatch(/setZ\(k, sampleHeight\(-pos\.getX\(k\)/)
    // 共面接缝不设任何人工补偿（?poff / ?seamfix 均已于 2026-10-10 撤除）
    expect(mapWorldSrc).not.toMatch(/scenerySeamLift|instanceSeamLift|TERRAIN_SEAM_BAND/)
    expect(mapWorldSrc).not.toMatch(/get\('poff'\)|get\('seamfix'\)|get\('terrainlod'\)/)
    // 高度场一份到底（2026-10-11 用户裁示"只对齐客户端"）；双场概念与 terrainCover、
    // structs 脚印管线禁止复活
    expect(mapWorldSrc).not.toMatch(/applyTerrainCover|terrainCover/)
    expect(mapWorldSrc).not.toMatch(/renderField/)
    expect(mapWorldSrc).not.toMatch(/structFootprint|structs\.u8\.bin/)
    // sampleHeight 读 heightField（唯一场）；拾取/贴地/贴花与渲染同源（客户端同构）
    const shAt = mapWorldSrc.indexOf('function sampleHeight')
    expect(shAt).toBeGreaterThan(-1)
    const shBody = mapWorldSrc.slice(shAt, mapWorldSrc.indexOf('function ', shAt + 10))
    expect(shBody).toMatch(/heightField/)
  })




  it('贴花材质（客户端 MATERIAL_DECAL）：UV1 采 colormap、不受光、×2.0，且接线在受光兜底之前', () => {
    // 2026-10-10 用户"铁轨贴图看起来太亮"：客户端把 `Decal.material` 的网格当**贴花**渲染
    // （`albedo(UV0) × colormap(UV1) × 2.0`，全程无光照项）；我们此前没有该路径 ⇒ 落到受光
    // Lambert（太阳+环境）⇒ 亮一档。数据面：导出器 `decal_capable` 打 `extras.decal` 并随导
    // TEXCOORD_1（forgecity rails/border 3 支材质）。
    // ⚠️ `src` = playbackScene.js（剥注释后的**接线**），`matSrc` = sceneryMaterials.js
    const decalSrc = matSrc.slice(matSrc.indexOf('export function makeDecalMaterial'),
                                  matSrc.indexOf('export function makeWaterMaterial'))
    expect(decalSrc.length).toBeGreaterThan(500)
    // ① 顶点期 UV1 原样（客户端无 uvScale/uvOffset）
    expect(decalSrc).toMatch(/vUv1 = uv1;/)
    // ② decal 槽 = 地图 colormap，用 UV1 采样；separate_lm 时再乘 colormap 的 alpha（本包 lm.webp 的 R）
    expect(decalSrc).toMatch(/vec3 decalRgb = texture2D\(colormap, vUv1\)\.rgb;/)
    expect(decalSrc).toMatch(/shadowColor \*= texture2D\(colormapLm, vUv1\)\.r;/)
    // ③ DRAW PHASE：albedo × shadowColor × 2.0，**不得出现任何光照项**
    expect(decalSrc).toMatch(/gl_FragColor = vec4\(base\.rgb \* uTint \* shadowColor \* 2\.0, 1\.0\);/)
    expect(decalSrc).not.toMatch(/uSunDirScene|uSunColor/)
    // ④ GLOBAL_TINT 的 brightness/contrast/gamma（materialLightmapAdjustment，默认无操作）
    expect(decalSrc).toMatch(/decalRgb = pow\(decalRgb, vec3\(uLmAdjust\.z\)\);/)
    expect(decalSrc).toMatch(/decalRgb = \(decalRgb - 0\.5\) \* uLmAdjust\.y \+ 0\.5;/)
    expect(decalSrc).toMatch(/decalRgb \+= uLmAdjust\.x;/)
    // ⑤ 仍带对数深度（漏了会整片不渲染/深度错）
    expect(decalSrc).toMatch(/#include <logdepthbuf_fragment>/)
    // ⑥ 接线半句（decal extras → makeDecalMaterial 路由/槽位/separateLm，先于光照图）：
    // 2026-11-12 接替：groundPass.test.js:270/297（装配路由行为）+
    // sceneryMaterials.materials.test.ts（LM/decal 材质工厂行为）
  })



  it('共面接缝不做人工补偿（客户端无深度偏移、数据同样共面；2026-10-10 撤掉 ?poff 与 ?seamfix）', () => {
    // 事实（数据层，逐点实测）：铺装（地形）与挡土墙顶/建筑基础在客户端是**吸附齐平**的
    // ——沿墙顶缝 92% 的采样 |地形−结构| ≤1 cm、地形略高者 75% ≤2 cm / 98% ≤5 cm、尾巴到 42 cm。
    // 客户端两条手法都没有：① 材质层 `Data/Materials/*` 52/52 模板无 `DepthBias`/`SlopeScaleDepthBias`
    // （引擎 `sl_Parser.cpp:282-283` 认识这两个材质状态字段，本图未用；.sc2 里同名命中只是 FX 参数
    // `constantDepthBias`/`depthDifferenceSlope` 的子串）；② 几何层同一份数据同样共面。
    // ⇒ 我们俯瞰时缝上的逐像素抢胜与客户端**同源**，属相机差异（客户端贴地视角被结构自身遮挡），
    // 不是实现差异；任何"深度偏移/几何让步"都只能靠手工调参（此前 ?poff 的注释原文即"由目视定"），
    // 故一并撤除。此断言防其复活。
    expect(src).not.toMatch(/sceneryOffsetMats|applySceneryOffset|POFF_UNITS|POFF_REF_DIST/)
    expect(src).not.toMatch(/polygonOffsetUnits = -units/)
  })



  it('禁止按逐网格三角形/顶点比删几何（统计启发式；损坏应由导出器语义标记/报错）', () => {
    // 旧版导出器撕裂批次曾用 (ic/3)/vc > 15 + ?degrade=N 在生产路径逐网格删除。
    // 这属于按内容统计量决定语义，禁止；树批次已在导出器修正，
    // 消费端不得再静默删网格。
    expect(src).not.toMatch(/degradedMeshes/)
    expect(src).not.toMatch(/degLimit/)
    expect(src).not.toMatch(/location\.search\)\.get\('degrade'\)/)
  })



  it('视角淡出效果片（AlphaBlend + BLEND_BY_ANGLE）：软混合 + 客户端视角因子，不被裁切', () => {
    // 客户端 `Textured.material` 的 AlphaBlend 预设（TransclucentRenderLayer + blend +
    // depthWrite:false）+ flags BLEND_BY_ANGLE（materials-fp.sl:378-384）。rays.sc2 这类
    // "白 RGB + 图案全在 alpha"的光束片按裁切会掉 95% 内容（2026-10-09 用户报障）。
    const at = matSrc.indexOf('export function makeBlendByAngleMaterial');
    expect(at).toBeGreaterThan(-1);
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10));
    expect(fn).toMatch(/float VdotN = abs\(dot\(V, N\)\);/);
    expect(fn).toMatch(/VdotN = mix\(VdotN, 1\.0 - VdotN, uInversion\);/);
    expect(fn).toMatch(/float ang = clamp\(\(VdotN - uBounds\.x\) \/ max\(uBounds\.y - uBounds\.x, 1e-6\), 0\.0, 1\.0\);/);
    expect(fn).toMatch(/gl_FragColor = vec4\(c\.rgb, c\.a \* pow\(ang, uPower\)\);/);
    expect(fn).toMatch(/transparent: true,/);
    expect(fn).toMatch(/depthWrite: false,/);            // 客户端该预设 depthWrite: false
    // 接线半句（blendByAngle extras → makeBlendByAngleMaterial 路由；alphaBlend 不被
    // 伪透明分流削掉 + 缓存键标记）2026-11-12 接替：
    // sceneryMaterials.materials.test.ts 行为测试（blendByAngle fixture / alphaBlend 缓存键分流）
  })



  it('水面"海岸线"coastLine：按客户端 water-fp.sl 的相对深度差口径淡出反射（距离无关、随相机高低自适应）', () => {
    // 2026-10-10 报障链：马利诺夫卡"水面与地形交界处锯齿状条带，非常生硬"。实测两件事：
    //  ① 那些"水面"是 `env_ma_ice02_*` 冰面片（统一高度 12.260、60×60 m、25 片成链），每片**正下方
    //     1 cm 处**另有一片不透明冰 `env_ma_ice01_*`（12.250，材质 extras 无 water、有 lightmap，
    //     客户端 `ro.flags=2049` 含 VISIBLE_REFRACTION ⇒ 它才是"透过水看到的冰"）；
    //  ② 地形穿过水面的等高线本身是**平滑**的（逐行追踪：每行跨过 12.260 的位置单调平移 0–2 texel），
    //     ⇒ 锯齿不是地形戳出，而是**水面自己**在岸线处的贡献：水面贡献 = 菲涅尔反射（我们的 alpha），
    //     岸线带里它与地形逐像素争深度（|地形−水面| 小于该视距深度分辨率处翻转）⇒ 硬边 + 锯齿。
    //  客户端的 coastLine（`water-fp.sl` 的 `RETRIEVE_FRAG_DEPTH_AVAILABLE` 分支）正是为它而设：
    //    `adjustedDifference = 2·|ndcZ_片元 − ndcZ_背后表面|/ndcZ_片元`，saturate 后 `fresnel *= coastLine`
    //    ——岸线带里反射项被抹掉（客户端同时露出它的折射通道 = 同一幅地形图，故无可见接缝）。
    //  我们无深度预通道，从该等式反推等价值：`ΔndcZ/ndcZ = Δz_沿视线/z_沿视线`，且 `z_沿视线·|视线.y|
    //    = 沿视线差`、`Δz_沿视线 = (水面高 − 地形高)/|视线.y|`、`uDepthUlp = 2/2^depthBits`
    //    ⇒ coastLine = saturate(dNdcZ / (2·uDepthUlp))：淡出带 = 该视距下深度抢胜带（2 ulp）。
    //  ⚠️ 曾用"该视距下地形单元格上界"（∝视距）当淡出宽度：与客户端无关，且远景把水整片洗掉
    //  （用户"水面贴图也不太对了"）。此用例同时钉死正确口径并禁止那两个错误写法复活。
    expect(asmSrc).toMatch(/coast: waterCoast, wro: ud\.water,/)
    expect(mapWorldSrc).toMatch(/if \(waterTexDispose\) \{ waterTexDispose\.dispose\(\); waterTexDispose = null; \}/)
    // 资源构造与阈值（makeWaterCoast / uDepthUlp = 2/2^depthBits）2026-11-12 接替：
    // groundPass.behavior.test.ts 行为测试（24/16bit 阈值、数据纹理口径）
    expect(mapWorldSrc).toMatch(/function terrainSpanOf\(\) \{/)
    expect(mapWorldSrc).not.toMatch(/terrainCellBound\(1, camera/)  // 旧"单元格上界"口径：禁止复活
    const wSrc = readSrc(resolve(here, 'sceneryMaterials.ts'), 'utf8')
    expect(wSrc).toMatch(/export function makeWaterMaterial\(m: GltfSceneMaterial, \{ normalTex, cubeTex, props, coast = null, wro = null \}: \{/)
    expect(wSrc).toMatch(/uniform sampler2D uHeightmap;/)
    // 阈值量纲 = **本渲染器的深度分辨率**（2 ulp）：岸线带（差值小到缓冲分不开）淡出、
    // 深水任何角度满反射（含俯视）。旧的"相机高 − 水面高"分母已废（俯视时深水被压没）。
    expect(wSrc).toMatch(/float dNdcZ = \(2\.0 \* uFar \* uNear \/ \(\(uFar - uNear\) \* zlen \* zlen\)\) \* dzAlong;/)
    // 深度精度带（D5 口径）保留为 byDepth；再与世界空间最小淡出带取 min（远处稳定，
    // 粗高度场 + 固定米制过渡——2026-11-17 用户"远处水面闪烁"）
    expect(wSrc).toMatch(/float byDepth = clamp\(dNdcZ \/ \(2\.0 \* uDepthUlp\), 0\.0, 1\.0\);/)
    expect(wSrc).toMatch(/float byWorld = smoothstep\(0\.0, uCoastFade, dzWorld\);/)
    expect(wSrc).toMatch(/coastLine = min\(byDepth, byWorld\);/)
    expect(wSrc).toMatch(/float dzWorld = vWorldP\.y - terrainY;/)
    expect(wSrc).toMatch(/float dzAlong = dzWorld \/ max\(abs\(toCam\.y\) \/ zlen, 1e-3\);/)
    // 纹素中心在 `(j+0.5)/n`、地形顶点在 `j/n`（corner 口径）⇒ 采样加半个纹素，岸线高度才与网格同位
    expect(wSrc).toMatch(/float terrainY = texture2D\(uHeightmap, vWorldP\.xz \/ uMapSpan \+ 0\.5 \+ 0\.5 \* uHmTexel\)\.r;/)
    expect(wSrc).toMatch(/uHmTexel: \{ value: \(\(\) => \{[\s\S]*?img\.width > 0 \? 1 \/ img\.width : 0\s*\}\)\(\) \},/)
    // 高度场唯一解码口径（场景系引擎顶点；旧包列翻转偏一格在读取边界补正）——网格/采样/岸线共用这一份；
    // 读取在 groundPass.loadTerrain（俯视烘焙同一份）
    expect(gpSrc).toMatch(/const matched = await terrainBinMatchesMeta\(tbuf, meta\);[\s\S]*?if \(matched\) \{[\s\S]*?decodeTerrainField\(tbuf, meta\)/)
    // json/bin 配对（PR #615 review P2）：bin 以 terrainBinSha256 作缓存键、解码前核对字节
    expect(mapWorldSrc).toMatch(/fetchFn: \(u: string\) => assetProvider\.fetch\(u\),/)
    expect(gpSrc).toMatch(/fetchFn\(pairedTerrainBinUrl\(binUrl, meta\)\)/)
    expect(gpSrc).toMatch(/const matched = await terrainBinMatchesMeta\(tbuf, meta\)/)
    expect(mapWorldSrc).not.toMatch(/heightField\[i\] = u16\[i\]/)
    // 查看器正俯视补偿：alpha = max(菲涅尔, uMinAlpha) × coastLine（客户端贴地相机无此视角；
    // 595m 正俯视下 fresnel≈bias 0.05 ⇒ 水面会等于透明，只剩海床）
    expect(wSrc).toMatch(/float alpha = max\(clamp\(fresnel, 0\.0, 1\.0\), uMinAlpha\) \* coastLine;/)
    expect(wSrc).toMatch(/uMinAlpha: \{ value: 0\.32 \},/)
    expect(wSrc).not.toMatch(/uCoastCellPerDist|cellPerDist/)
    expect(wSrc).not.toMatch(/max\(cameraPosition\.y - vWorldP\.y, 1e-3\)/)     // 旧"相机高"口径：禁止复活
  })



  it('水下静态件不接光照图：按客户端折射通道口径（VIEW_DIFFUSE=0 ⇒ albedo，不受光、不乘 2）', () => {
    // 2026-10-10 用户"马利诺夫卡水面边缘位置是黑色、与地形分隔锯齿状"。实测真因链：
    //  ① 那圈"水面"边缘的黑来自 25 片水下冰面片 `env_ma_ice01_*`（水面片正下方 1 cm，
    //     材质 `TextureLightmap.material` + `flags.FLATCOLOR`，客户端 `ro.flags=2049` 含
    //     `VISIBLE_REFRACTION` = 只经折射通道可见）；
    //  ② 它们在客户端光照图图集里的格子**是未烘焙的黑区**（按客户端自己的 uvScale/uvOffset
    //     采样，图像 8 内实测若干片区域 63–71% 全黑；图集本身 22% 黑 = 未烘区）⇒ 我们按主
    //     通道 `albedo × lightmap × 2` 渲染 = 黑冰面；
    //  ③ 客户端看不到这层乘法：`materials-fp.sl` 的 DRAW PHASE 里 `albedo × lightmap × 2`
    //     只在 `#if MATERIAL_LIGHTMAP && VIEW_DIFFUSE` 下发生，而水下件只出现在
    //     `ReflectionRefraction` 通道（VIEW_DIFFUSE=0）的画面里——那片水面是**不透明**的
    //     （`water-fp.sl` 的 REAL_REFLECTION 分支 `outColor.a = 1`），岸线带露出的是折射画面。
    //  ④ 判据纯几何：整个包围盒落在某片水面占地内（0.5 m 余量）且低于其标高（5 cm 余量）
    //     ⇒ 不接光照图、走不受光 albedo。受灾面实测仅 2 图：malinovka 26 实例 / italy 1。
    // 断言防"水下件又乘回光照图"。GLB 仍是场景系（z=高度），判据里的高度即 z。
    // 2026-10-14 抽层：水面片收集 / underWater 判据 / 分派都在共享装配模块（asmSrc）
    expect(asmSrc).toMatch(/export function collectWaterSurfaces\(root: Object3D\): WaterSurfaceFootprint\[\] \{\n\s*root\.updateMatrixWorld\(true\);\n\s*const waterSurfaces: WaterSurfaceFootprint\[\] = \[\];/)
    expect(asmSrc).toMatch(/export function makeUnderWater\(waterSurfaces: readonly WaterSurfaceFootprint\[\]\): \(o: Mesh\) => boolean \{\n\s*return \(o\) => \{/)
    expect(asmSrc).toMatch(/bb\.max\.z <= w\.h \+ 0\.05\) return true;/)
    expect(asmSrc).toMatch(/const uw = !!o\.geometry && underWater\(o\);/)
    expect(asmSrc).toMatch(/if \(ud\.lightmap !== undefined && !isWaterNode\(o\.name, m, \{ strictSurfaces \}\)\s*\n\s*&& !isSkyNode\(o\) && !underWater\(o\)\) \{/)
    expect(asmSrc).toMatch(/if \(uw\) \{/)
    expect(asmSrc).toMatch(/new THREE\.MeshBasicMaterial\(\{/)
    expect(asmSrc).toMatch(/map: m\.map \|\| null,/)
    // 水上面向不走这条：判据只在"整个包围盒低于水面片标高"成立，且水/天空已排除
    expect(asmSrc).not.toMatch(/underWater\(o\) \|\| true/)
    // 运行时调用共享装配时把水面海岸线资源传进去（水下判据不需要它，但水面材质吃）
    expect(mapAssetsSrc).toMatch(/assembleSceneryMaterials\(gltf, \{/)
    expect(mapAssetsSrc).toMatch(/groundLayers, waterCoast, debug: DEBUG,/)
  })



  it('细分判据回到客户端三条：playbackScene 不再计算/传递岸线标高表（第四条判据 2026-10-11 评审删除）', () => {
    // 2026-10-10 曾以"岸线特征"第四条判据把水陆交界一路细到 1 texel（真图实测过收益）；
    // 2026-10-11 PR 评审：DAVA `SubdividePatch` 没有这条判据，与"纯客户端三判据"目标冲突 ⇒
    // 整体删除（岸线视觉由水材质/coastLine 处理，不改地形 tessellation）。
    // 本守卫锁死删除：`shores`/`shoreLevels`/`shoreHit` 均不得再现于两个模块。
    expect(mapWorldSrc).not.toMatch(/shores:/)
    expect(mapWorldSrc).not.toMatch(/shoreLevels/)
    const meshSrc = readSrc(resolve(here, 'terrainMesh.js'), 'utf8')
    expect(meshSrc).not.toMatch(/shores/)
    expect(meshSrc).not.toMatch(/shoreHit/)
    // #954 后纯数据阶段在 groundGeometryData.ts（Worker 与俯视烘焙共用同一份），
    // 不再直接出现在 groundPass.js 的闭包里。
    const gdSrc = readSrc(resolve(here, 'groundGeometryData.ts'), 'utf8')
    expect(gdSrc).toMatch(/buildAdaptiveTerrain\(\{/)
    expect(mapWorldSrc).toMatch(/buildGroundGeometryTyped\(\{/)
  })



  it('地面分层混合 uniform 类型对齐：uHbSoft 必须 vec4（曾误写 float ⇒ 值 NaN ⇒ 地面取错层色）', () => {
    // 2026-10-10 用户"米德尔堡地面贴图颜色还是不对"（= erlenberg，display='Middleburg'）。
    // 实况：`groundShaderMaterial` 的片元里 `uHbSoft` 被写成 `uniform float`，而 JS 侧下发
    // `new THREE.Vector4(L.hb_softness…)` ⇒ three 按**声明类型**上传（uniform1f 收到对象 ⇒ NaN）
    // ⇒ 开 HEIGHT_BLEND 的 9 图（desert_train/erlenberg/holland/idle/lagoon/plant/pliego/rift/rudniki）
    // 高度分层混合权重全废、地面取错层色。着色器门禁只编译（`vec4 − float` 是合法标量广播）⇒ 抓不到，
    // 故此处用类型对齐守卫看护：声明类型必须与 JS 下发值一致。
    // 2026-10-14 地面 pass 抽层：着色器声明与 JS 下发都在共享模块 groundPass（俯视烘焙同一份）
    expect(gpSrc).toMatch(/uniform vec4 uHbSoft;/)
    expect(gpSrc).not.toMatch(/uniform float uHbSoft;/)
    // JS 下发值（uHbSoft/uHbScale/uHbOffset = Vector4 逐分量）2026-11-12 接替：
    // groundPass.behavior.test.ts 行为测试（instanceof Vector4 + 声明/下发一致）
  })



  it('逐图光照亮度归一：保留方向/色相，曝光 = 基准太阳强度 / 该图太阳强度（模拟客户端自动曝光）', () => {
    // 2026-10-10 用户"米德尔堡地面颜色还是不对"：线上部署版**不消费 lighting.json**（0 处引用），
    // 用固定兜底灯（白 3.0 + 半球 2.4）；我们按计划书"期 1"搬了逐图太阳（36 图 intensity 3–14、
    // 色相各异）却还没做"期 2"的曝光标定 ⇒ 走 three 内建管线的材质（受光场景件 = 河床/铺装等
    // Lambert 件、坦克）被照成 2–5× 基准 ⇒ 线性输出削顶、发白偏橙。用户裁示"保色相、归亮度"：
    // 保留 sun.direction/color（逐图氛围），曝光按该图太阳强度归一到 DEFAULT_SUN_INTENSITY 那一档
    // ——同一图内 太阳:环境:IBL 的相对关系不变，仅把绝对亮度钉回基准（≈ 固定曝光模拟自动曝光）。
    expect(rendererSrc).toMatch(/renderer\.toneMapping = THREE\.LinearToneMapping;/)
    // 归一与复位体 2026-11-12 接替：mapLighting.test.js（expo=3/8 归一、clamp 0.05–4、复位）
  })



  it('水体：透明面写深度 + 双面 + 不设 renderOrder', () => {
    expect(matSrc).toMatch(/const isWaterName = \(n: string \| null \| undefined\): boolean => \/water\|sea\|lake\|river\|fountain\/i\.test\(n \|\| ''\);/)
    // 水面判定改为**材质级标记**驱动（新包 asset.extras.surfaceFlags ⇒ 读材质 extras.water；
    // 旧包退回名字启发式）——名字启发式曾把水塔 `bld_er_water_tower_pbr` 误判成水面，
    // 使该建筑退回受光材质整体发白（2026-10-09 用户报障）。判定自 2026-10-14 抽为共享
    // 规则模块（SSOT，与俯视烘焙**同一份**——烘焙此前复制名字启发式而漂移出双向错剔），
    // 本页只保留委托与本地签名；判定本体与真名案例回归见 sceneryAssemblyRules.test.js。
    expect(mapAssetsSrc).toMatch(/import \{[^}]*isWaterNode as isWaterNodeRule[^}]*\} from '\.\.\/sceneryAssemblyRules\.js'/)
    expect(mapAssetsSrc).toMatch(/const strictSurfaces = strictSurfacesOf\(gltf\.scene\);/)
    expect(mapAssetsSrc).toMatch(/const isWaterNode = \(name: string, mat: import\('\.\.\/sceneryAssemblyRules\.js'\)\.SurfaceMaterial \| null \| undefined\) =>\n    isWaterNodeRule\(name, mat, \{ strictSurfaces \}\);/)
    expect(mapAssetsSrc).toMatch(/!\(e\.node\.userData && e\.node\.userData\.isSky\)[\s\S]{0,120}!isWaterNode\(e\.name, e\.material\)[\s\S]{0,120}!hasTransparentMaterial\(e\.material\)/)
    expect(asmSrc).toMatch(/o\.userData\.isSky = true;/)
    // 运行时：包级天空标记在变体裁剪之前采样，并显式传入装配
    const skyFlagAt = mapAssetsSrc.indexOf('const skyFlagsAvailable = sceneHasSkyFlags(gltf.scene)')
    const pruneAt = mapAssetsSrc.indexOf('pruneForeignVariantsDetailed(gltf.scene')
    expect(skyFlagAt).toBeGreaterThan(-1)
    expect(pruneAt).toBeGreaterThan(skyFlagAt)
    expect(mapAssetsSrc).toMatch(/assembleSceneryMaterials\(gltf, \{[\s\S]{0,500}skyFlagsAvailable,/)
    // MEDIUM 档水面是半透明大面：逐材质修整（depthWrite/DoubleSide/depthTest）必须保留——
    // 2026-10-09 随 LOW 档（不透明）删过一次，回退 MEDIUM 时一并恢复。
    // 逐材质修整半句（depthWrite=true + DoubleSide + 不设 renderOrder）2026-11-12 接替：
    // sceneryMaterials.materials.test.ts 行为测试（water 名 fixture）
  })
})
