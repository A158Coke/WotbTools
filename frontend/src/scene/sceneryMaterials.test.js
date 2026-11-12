import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// 源码读取统一 LF 归一（2026-10-15）：本机 core.autocrlf 检出为 CRLF 时，守卫里的 LF 锚点
// （如大括号后紧跟换行的模式）会整片不匹配（CI 检出为 LF 才绿）——读取即归一，与检出风格无关。
const readSrc = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
// 先剥注释：断言只看代码，注释里提到的反例写法（如 "写成 userData.extras.occMean 会…"）
// 不得影响判据。
const src = readSrc(resolve(here, 'playbackScene.js'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
// 常量/并发工具与边界带 2026-10-24 出仓 playback/（巨石拆分 Step A1，守卫随实现迁移）
const pbUtilSrc = readSrc(resolve(here, 'playback/util.ts'), 'utf8')
const bandSrc = readSrc(resolve(here, 'playback/boundary.ts'), 'utf8')
// 3D 战斗反馈 transient（伤害/击毁事件源、壁钟幽灵段/受击闪）2026-11-05 出仓
// playback/transientFeedback3d.ts（#820 Wave B6B；事件源/游标守卫随实现迁移）
const transientSrc = readSrc(resolve(here, 'playback/transientFeedback3d.ts'), 'utf8')
// 渲染器创建核心 2026-10-24 出仓 playback/renderer.js（Step A2；出屏口径/对数深度/兜底灯光
// 的装配断言随实现迁移）
const rendererSrc = readSrc(resolve(here, 'playback/renderer.ts'), 'utf8')
// 场景装配块 2026-10-24 出仓 playback/mapAssets.js（Step A3；运行时侧装配断言随实现迁移）
const mapAssetsSrc = readSrc(resolve(here, 'playback/mapAssets.ts'), 'utf8')
// 基地贴地标记 2026-10-24 出仓 playback/bases.js（Step A4；基地环/圆盘/画布 sRGB 断言随实现迁移）
const basesSrc = readSrc(resolve(here, 'playback/bases.ts'), 'utf8')
const glbPartsSrc = readSrc(resolve(here, 'playback/glbParts.ts'), 'utf8')
// 材质实现（billboard/speedtree/缓存/常量/isWaterName）已平移至专用模块（SSOT，
// bake-ground-overhead 烘焙页共用同一实现），守卫随迁读取新源
const matSrc = readSrc(resolve(here, 'sceneryMaterials.ts'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
// 逐图光照应用层（2026-10-14 抽层：运行时与俯视烘焙共用同一份——见 mapLighting.js 头部）
const mlSrc = readSrc(resolve(here, 'mapLighting.ts'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
// 场景装配 SSOT（2026-10-14 抽层：extras 贴图解 + 逐节点材质分派 + 水面修整——运行时与
// 俯视烘焙共用同一份，见 sceneryAssembly.js 头部；本节相关守卫随迁读取新源）
const asmSrc = readSrc(resolve(here, 'sceneryAssembly.ts'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
// 地面 pass SSOT（2026-10-14 抽层：地形数据/几何、分层地表材质、水面海岸线资源——运行时与
// 俯视烘焙共用同一份，见 groundPass.js 头部；地面相关守卫随迁读取新源）
const gpSrc = readSrc(resolve(here, 'groundPass.js'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
// #913 拆分后的运行时 owner（守卫随实现迁移）：地面/LOD/IBL/照明 → mapWorld，
// 车辆位姿/悬挂 → vehicleRuntime，战斗特效 → battleRuntime，标签 → labelsRuntime，
// 性能探针 → perfProbe，材质回收核心 → materialDispose。
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const mapWorldSrc = stripComments(readSrc(resolve(here, 'playback/mapWorld.ts')))
const vehSrc = stripComments(readSrc(resolve(here, 'playback/vehicleRuntime.ts')))
const battleSrc = stripComments(readSrc(resolve(here, 'playback/battleRuntime.ts')))
const lblSrc = stripComments(readSrc(resolve(here, 'playback/labelsRuntime.ts')))
const perfSrc = stripComments(readSrc(resolve(here, 'playback/perfProbe.ts')))
const matDisposeSrc = stripComments(readSrc(resolve(here, 'materialDispose.ts')))
const treadSrc = stripComments(readSrc(resolve(here, 'playback/treadRuntime.ts')))
const lifecycleSrc = stripComments(readSrc(resolve(here, 'playback/sessionLifecycle.ts')))

// 场景内核依赖 WebGL，无法直接实例化；此仓已有源码级契约测试的先例（labelOcclusion.test.js）。
// 本文件守卫「场景 GLB 材质管线」，即本轮从上游补齐的渲染实现——它们此前在本仓缺失，
// 且都属于"少一行就退化成逐 mesh 建材质 / 透明队列闪烁"的接线型不变量。
describe('场景 GLB 材质管线（对齐上游的渲染实现）', () => {
  it('材质实例按 key 去重：convMat 经 cachedSceneryMat，键含 alphaTest/transparent', () => {
    // 回归：逐 mesh 各建一份材质 → 材质/着色器实例与 program 切换随 mesh 数线性膨胀
    // 2026-10-14 抽层：convMat 在共享装配模块（asmSrc），运行时与烘焙同一份
    expect(asmSrc).toMatch(/const convMat = \(m: GltfSceneMaterial, isCard: boolean\) => cachedSceneryMat\(/)
    const key = asmSrc.slice(asmSrc.indexOf('const convMat = (m: GltfSceneMaterial, isCard: boolean) => cachedSceneryMat('))
    expect(key.slice(0, 900)).toMatch(/m\.alphaTest \?\? 0/)
    expect(key.slice(0, 900)).toMatch(/!!m\.transparent/)
    expect(key.slice(0, 900)).toMatch(/m\.map \? m\.map\.uuid : ''/)
    // 运行时只消费装配模块导出的入口（本地不得再自建 convMat——防两套复辟）
    expect(mapAssetsSrc).toMatch(/from '\.\.\/sceneryAssembly\.js'/)
    expect(src).not.toMatch(/const convMat = \(m, isCard\)/)
  })

  it('disposeObject3D 经 collectMaterialTextures 回收纹理（含 ShaderMaterial uniforms）', () => {
    // 回归：ST| 静态 ShaderMaterial 的纹理在 uniforms.map.value，直接属性枚举
    // 触发零次 dispose → 切图累积 GPU 显存
    // 实现 2026-11-05 出仓 materialDispose.ts（#913 合并后行数门禁）；守卫随实现迁移
    expect(src).toMatch(/import \{ collectMaterialTextures, disposeObject3D \} from '\.\/materialDispose\.js'/)
    const at = matDisposeSrc.indexOf('export function disposeObject3D')
    expect(at).toBeGreaterThan(-1)
    expect(matDisposeSrc.slice(at, at + 900)).toMatch(/collectMaterialTextures\(m, texs\)/)
  })

  it('材质缓存随会话释放（勿复用已 dispose 实例）', () => {
    // 必须在 teardown 里清空——mapScenery 在同一段被 dispose，缓存留着就会
    // 复用已释放的材质实例。地图资源 teardown owner 2026-11-05 出仓 playback/mapWorld
    //（#913），守卫随实现迁移；宿主 teardownSession 仍必须调用 mapWorld.dispose()
    const at = mapWorldSrc.indexOf('function dispose()')
    expect(at).toBeGreaterThan(-1)
    expect(mapWorldSrc.slice(at, at + 1200)).toMatch(/clearSceneryMatCache\(\);/)
    expect(src).toMatch(/mapWorld\.dispose\(\);/)
  })

  it('真混合层（extras.blendLayer）保留软 alpha：不被伪透明分流削成硬边卡片', () => {
    // 回归：导出器标记的混合层（烟雾/瀑布/浪 = 动画 + 掩码）其 alpha 是掩码烘出的软渐变，
    // "BLEND 但不透明度≈1 → 转不透明 + alphaTest 0.33"会把霾削成硬边卡片
    //（2026-10-09 himmelsdorf 烟囱烟雾报障：掩码单通道值一度烘成二值剪影）。
    // 装配半句（blendLayer 软 alpha、缓存键含 alphaBlend 标记）2026-11-12 接替：
    // sceneryMaterials.materials.test.ts 行为测试（assembleSceneryMaterials 分流 + 同输入同实例）
    // 俯视烘焙页与内核同约定（SSOT 守卫：两侧消费**同一份装配模块**，键指纹与分流口径
    // 只有一处实现——烘焙页本地不得再复辟任何分流/键组成代码）
    const bakeSrcBlend = readSrc(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'), 'utf8');
    expect(bakeSrcBlend).toMatch(/from '\/src\/scene\/sceneryAssembly\.js'/);
    expect(bakeSrcBlend).toMatch(/assembleSceneryMaterials\(gltf, \{/);
    expect(bakeSrcBlend).not.toMatch(/!blendLayer && !softAlpha/);
  });

  it('动画混合层：双采样器（albedo 走 UV0+位移 / 掩码走 UV1）+ 回放时钟驱动', () => {
    // 客户端 materials-vp.sl：`varTexCoord0.xy += texture0Shift + frac(tex0ShiftPerSecond*globalTime)`，
    // 而掩码 `varTexCoord1 = texcoord1`（不动）⇒ 轮廓固定、纹理滚动。烘进同一张贴图的
    // alpha 会让轮廓随位移滑走、frac 回绕时跳变（2026-10-09 用户要求补滚动动画）。
    const matStart = matSrc.indexOf('export function makeBlendLayerMaterial');
    const fn = matSrc.slice(matStart, matSrc.indexOf('export function', matStart + 10));
    expect(fn).toMatch(/attribute vec2 uv1;/);                 // 掩码走 UV1
    expect(fn).toMatch(/vUv1 = uv1;/);
    expect(fn).toMatch(/fract\(uShiftRate \* uTime\)/);         // 客户端 frac(速率×时间)
    expect(fn).toMatch(/float a = texture2D\(mask, vUv1\)\.a;/);// alpha 来自掩码
    expect(fn).toMatch(/transparent: true,/)
    expect(fn).toMatch(/depthWrite: false,/)
    expect(fn).toMatch(/USE_INSTANCING/)                        // 合批批次的实例矩阵
    // 装配路由与 animLayerMats 登记（dep(ex.maskTexture) / maskTex 分流 / push）2026-11-12
    // 接替：sceneryMaterials.materials.test.ts 行为测试（blendLayer extras → ShaderMaterial
    // 带 uTime 且进 animLayerMats 返回值）
    // 逐帧写 uTime（回放秒数）：暂停即停、seek 后相位确定——时钟驱动留在运行时
    expect(src).toMatch(/for \(const mm of animLayerMats\) mm\.uniforms\.uTime\.value = secs;/)
    expect(src).toMatch(/const secs = T \/ 1000;/)
  })

  it('自定义材质的 varying 必须在顶点着色器里被赋值（"只声明不写"会让整材质链接失败）', () => {
    // 回归：曾出现"声明了 varying 却从不赋值、片元又读它"（整批材质按链接错误不渲染，
    // 表现为"物体不可见"）。此守卫对全部自定义 vertexShader 生效：凡声明的 varying
    // 至少要有一处赋值；同理也不得出现只写不声明的标识符。
    const shaders = [...matSrc.matchAll(/vertexShader:\s*`([^`]*)`/g)].map((m) => m[1]);
    expect(shaders.length).toBeGreaterThanOrEqual(4);
    for (const sh of shaders) {
      const decls = [...sh.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
      expect(decls.length).toBeGreaterThan(0);
      for (const name of decls) {
        // 不用 RegExp：转义在字符串字面量里会被吃掉（'\s' → 's'），改用直白的 includes
        expect(sh.includes(name + ' =')).toBe(true);
      }
    }
    // 片元的 varying 必须是顶点的子集（link 契约）：孤儿声明（只出现在片元）会整材质
    // 编译失败——2026-10-09 回退过程中出现过一次，页面表现同样是"物体不可见"。
    const pairs = [...matSrc.matchAll(/vertexShader:\s*`([^`]*)`[\s\S]{0,200}?fragmentShader:\s*`([^`]*)`/g)];
    expect(pairs.length).toBeGreaterThanOrEqual(4);
    for (const [, vs, fs] of pairs) {
      const vNames = new Set([...vs.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]));
      const fNames = [...fs.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
      for (const name of fNames) expect(vNames.has(name)).toBe(true);
    }
  })

  it('环境反射（ENVIRONMENT_MAPPING）：遮罩×菲涅尔×天空立方图，含高光项', () => {
    // 客户端 materials-fp.sl:320-338 的反射块逐项对应；materials-vp.sl:270-276 的
    // 反射向量与权重（世界系 reflect + 菲涅尔×brighten）。
    const at = matSrc.indexOf('export function makeLightmappedMaterial');
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10));
    expect(fn).toMatch(/R = reflect\(V, N\);/);                       // 世界系反射向量
    expect(fn).toMatch(/F = uEnvFresnel \+ \(1\.0 - uEnvFresnel\) \* pow\(1\.0 - NdotV, 5\.0\);/);
    expect(fn).toMatch(/vec3 envMult = F \* \(uEnvBrighten \/ 3\.0\);/);
    expect(fn).toMatch(/float maskScaled = min\(envMaskValue \* uEnvMaskMul, 1\.0\);/);
    expect(fn).toMatch(/vec3 lightenLM = clamp\(lm \* uEnvMultLM, 0\.0, 1\.0\);/);
    expect(fn).toMatch(/float glossPower = pow\(5000\.0, uEnvGloss \* envMaskValue\);/);
    expect(fn).toMatch(/color = mix\(color, color \* uEnvAddDiffuse \+ refl, min\(envMaskValue \* uEnvLerp, 1\.0\)\)/);
    expect(fn).toMatch(/\+ specular \* maskScaled;/);
    expect(fn).toMatch(/vWorldN = normalize\(mat3\(im\) \* normal\);/);   // 顶点写入（链接契约）
    expect(fn).toMatch(/0\.5 - asin\(clamp\(d\.y, -1\.0, 1\.0\)\) \* 0\.3183098861837907/);
    // 条件编译用 #ifdef（`#if ENV_REFLECTION` 在 three 的 define 注入下展开为空 → 编译失败，
    // 本轮由门禁当场抓出）
    expect(fn).toMatch(/#ifdef ENV_REFLECTION/);
    expect(fn).not.toMatch(/#if ENV_REFLECTION/);
    // 共享太阳 uniform 接线（uSunDirScene 归一 / uSunColor = color×intensity）2026-11-12
    // 接替：mapLighting.test.js 行为测试（applyMapLightingCore fixture）
  })

  it('水面（MEDIUM 档）：双层滚动法线 + UDN + 菲涅尔 alpha + 逐图立方图', () => {
    // 客户端 water-fp.sl 的 !REAL_REFLECTION 分支（材质文件 WaterPerPixelCubemapAlphablend：
    // WaterRenderLayer + blend、alpha = 菲涅尔）：反射 = 逐图 cubemap × reflectionTintColor；
    // 法线 = 两层滚动法线图 UDN 相加（层 1 用 45° 旋转 UV）。
    // 档位沿革：2026-10-09 曾改采 LOW 档（不透明、零波形扰动），实看被判"不好"后按用户裁示
    // 回到 MEDIUM——此处守卫即"回退到位"的锚（LOW 档的 albedo/decal/reflectance 字段不得残留）。
    const at = matSrc.indexOf('export function makeWaterMaterial');
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10));
    expect(fn).toMatch(/vec2 uv1 = vec2\(vUv\.x \+ vUv\.y, vUv\.y - vUv\.x\) \* uN1Scale \+ fract\(uShift1 \* uTime\);/);
    expect(fn).toMatch(/normalize\(n0 \+ n1 - vec3\(1\.0\)\)/);                    // UDN 相加
    expect(fn).toMatch(/cotangentFrame\(normalize\(vWorldN\), vWorldP, vUv\)/);    // 导数建切线基
    expect(fn).toMatch(/float fresnel = uFresnelBias \+ \(1\.0 - uFresnelBias\) \* pow\(1\.0 - lambertFactor, uFresnelPow\);/);
    expect(fn).toMatch(/R\.y = abs\(R\.y\);/);                                    // 防穿透水面
    expect(fn).toMatch(/transparent: true,/);
    expect(fn).toMatch(/depthWrite: true,/);   // erlenberg 实测：水面不写深度会与地形逐像素闪
    expect(fn).not.toMatch(/albedoTex|decalTex|uReflectance|uDecalTint/);          // LOW 档字段零残留
    // 装配路由半句（water extras → makeWaterMaterial，transparent+depthWrite:true）
    // 2026-11-12 接替：sceneryMaterials.materials.test.ts 行为测试（ud.water 对象 fixture）
  })

  it('烘焙光照图：albedo × lightmap(UV1×逐实例变换) × 2、不受光、镂空保留', () => {
    // 客户端 materials-fp.sl 的 MATERIAL_LIGHTMAP：静态场景是**烘焙**结果，着色器里没有
    // 任何光照项；UV1 逐材质实例变换（varTexCoord1 = uvScale*texcoord1 + uvOffset）。
    const at = matSrc.indexOf('export function makeLightmappedMaterial');
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10));
    expect(fn).toMatch(/attribute vec2 uv1;/);
    expect(fn).toMatch(/attribute vec4 aLm;/);
    expect(fn).toMatch(/vLmUv = uv1 \* aLm\.xy \+ aLm\.zw;/);        // 客户端同式
    // ×2：客户端 `materials-fp.sl` 的 VIEW_ALBEDO 路径是 `color = albedo × lightmap × 2`
    expect(fn).toMatch(/vec3 color = c\.rgb \* uTint \* lm \* 2\.0;/);
    expect(fn).toMatch(/gl_FragColor = vec4\(color, 1\.0\);/);
    expect(fn).not.toMatch(/lambert|MeshBasic|lights/i);                 // unlit：不引光照
    expect(fn).toMatch(/USE_INSTANCING/);                                // 合批实例矩阵
    expect(fn).toMatch(/if \(uAlphaCut > 0\.0 && c\.a < uAlphaCut\) discard;/); // 镂空保留
    // 接线半句（lightmap extras → LM 路由/缓存键/环境反射槽判据）2026-11-12 接替：
    // sceneryMaterials.materials.test.ts 行为测试（LM extras → 缓存材质 + 指纹复用 + aLm 契约）
    // 逐实例属性：薄包装几何（属性对象原样引用，零重复上传），不得用 geometry.clone()
    const instSrc = readSrc(resolve(here, 'sceneryInstancing.ts'), 'utf8')
    expect(instSrc).toMatch(/lm: \(mesh\.userData && Array\.isArray\(mesh\.userData\.lm\)\) \? mesh\.userData\.lm : null,/)
    expect(instSrc).toMatch(/new THREE\.InstancedBufferAttribute\(arr, 4\)/)
    expect(instSrc).toMatch(/g\.setAttribute\(name, batch\.geometry\.attributes\[name\]\)/)
    expect(instSrc).not.toMatch(/batch\.geometry\.clone/)                 // 禁用 clone（clone 会复制属性对象 → 顶点重复上传）
  })

  it('细节层（B1）：uv0×scale 采样 ×2 乘入，位置在环境反射之后；两条路径都接线', () => {
    // 客户端 `MATERIAL_DETAIL`（materials-vp.sl:122/233 + materials-fp.sl:100/264/347）：
    // `varDetailTexCoord = uv0 × detailTileCoordScale`、DRAW PHASE 末尾
    // `color *= detailTextureColor.rgb * 2.0`（在光照图/环境反射/拼花砖之后）。
    // 实测 36 图 453 实例 / 10 图（forgecity 121、rift 103…）。
    const at = matSrc.indexOf('export function makeLightmappedMaterial');
    const fn = matSrc.slice(at, matSrc.indexOf('export function', at + 10));
    expect(fn).toMatch(/vDetailUv = uv \* uDetailScale;/);              // UV0 × scale（不是 UV1）
    expect(fn).toMatch(/color \*= texture2D\(uDetailTex, vDetailUv\)\.rgb \* 2\.0;/);
    // 位置：声明在 #ifdef 内（无 detail 的材质不编译该分支）；乘入在环境反射块之后、
    // 出屏写入之前（客户端 DRAW PHASE 同序）
    expect(fn).toMatch(/#ifdef MATERIAL_DETAIL/);
    expect(fn.lastIndexOf('#ifdef MATERIAL_DETAIL'))
      .toBeGreaterThan(fn.indexOf('#ifdef ENV_REFLECTION'));
    expect(fn.indexOf('uDetailTex, vDetailUv).rgb * 2.0;'))
      .toBeLessThan(fn.indexOf('gl_FragColor = vec4(color, 1.0);'));
    // 接线半句（detail extras → LM 分支实参 / Lambert patchSceneryDetail / 缓存键 detail
    // 身份）2026-11-12 接替：sceneryMaterials.materials.test.ts 行为测试
    // Lambert 补丁本体：注入点 + program 缓存键标记（与坦克补丁同法，防串用未打补丁程序）
    const pat = matSrc.indexOf('export function patchSceneryDetail');
    const pfn = matSrc.slice(pat, matSrc.indexOf('export function', pat + 10));
    expect(pfn).toMatch(/diffuseColor\.rgb \*= texture2D\(uDetailTex, vDetailUv\)\.rgb \* 2\.0;/);
    expect(pfn).toMatch(/\|scenery-detail/);
    // 烘焙页：消费同一装配模块（细节层路由不可能再与内核漂移），本地不得自建 convMat/detail 桩
    const bake = readSrc(resolve(here, '../../scripts/bake-ground-overhead.mjs'), 'utf8')
    expect(bake).toMatch(/assembleSceneryMaterials\(gltf, \{/);
    expect(bake).not.toMatch(/const convMat = \(m, isCard\)/);
    expect(bake).not.toMatch(/const detailTexOf = \(\) => null;/);
  })

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
    expect(asmSrc).toMatch(/coast: waterCoast \}\);/)
    expect(mapWorldSrc).toMatch(/if \(waterTexDispose\) \{ waterTexDispose\.dispose\(\); waterTexDispose = null; \}/)
    // 资源构造与阈值（makeWaterCoast / uDepthUlp = 2/2^depthBits）2026-11-12 接替：
    // groundPass.behavior.test.ts 行为测试（24/16bit 阈值、数据纹理口径）
    expect(mapWorldSrc).toMatch(/function terrainSpanOf\(\) \{/)
    expect(mapWorldSrc).not.toMatch(/terrainCellBound\(1, camera/)  // 旧"单元格上界"口径：禁止复活
    const wSrc = readSrc(resolve(here, 'sceneryMaterials.ts'), 'utf8')
    expect(wSrc).toMatch(/export function makeWaterMaterial\(m: GltfSceneMaterial, \{ normalTex, cubeTex, props, coast = null \}: \{/)
    expect(wSrc).toMatch(/uniform sampler2D uHeightmap;/)
    // 阈值量纲 = **本渲染器的深度分辨率**（2 ulp）：岸线带（差值小到缓冲分不开）淡出、
    // 深水任何角度满反射（含俯视）。旧的"相机高 − 水面高"分母已废（俯视时深水被压没）。
    expect(wSrc).toMatch(/float dNdcZ = \(2\.0 \* uFar \* uNear \/ \(\(uFar - uNear\) \* zlen \* zlen\)\) \* dzAlong;/)
    expect(wSrc).toMatch(/coastLine = clamp\(dNdcZ \/ \(2\.0 \* uDepthUlp\), 0\.0, 1\.0\);/)
    expect(wSrc).toMatch(/float dzAlong = \(vWorldP\.y - terrainY\) \/ max\(abs\(toCam\.y\) \/ zlen, 1e-3\);/)
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
    expect(wSrc).toMatch(/gl_FragColor = vec4\(refl, clamp\(fresnel, 0\.0, 1\.0\) \* coastLine\);/)
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
    expect(gpSrc).toMatch(/buildAdaptiveTerrain\(\{/)   // 地形构建入口在 groundPass（俯视烘焙同一份）
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

  it('对数深度缓冲：默认开启 + ?logdepth=0 逃生开关 + 两自定义 ShaderMaterial 挂 logdepthbuf 块（#827 F3: Integration Contract（无注入点）+ shader-lint PK）', () => {
    // 回放查看器允许 600–1000m 俯瞰（客户端贴地视角从不涉及）：线性 24bit 深度在该
    // 距离分辨率 4–12cm，与贴地装饰薄板/重建地形的厘米级交叠同量级 → 远景成片
    // z-fighting。对数深度恢复确定性深度序；因每片元写 gl_FragDepth（禁 early-z）
    // 有全局片元开销，?logdepth=0 提供真机回滚与 A/B 性能验收开关。自定义
    // ShaderMaterial 不自动注入 logdepthbuf 代码块，漏挂 = 该材质深度写回线性域，
    // 与其他物体深度语义割裂。
    // 2026-10-07：默认改为**关**（真机 A/B 权衡：每片元 gl_FragDepth + 禁 early-z
    // 对 alpha-test 植被的填充率开销是乘法级）；Display 面板开关 + localStorage
    // 持久化，URL ?logdepth= 仍最高优先（prefOf 解析）。
    expect(src).toMatch(/let LOGDEPTH = prefOf\('pb_logdepth', 'logdepth', false\);/)
    expect(src).toMatch(/let DYNRES = prefOf\('pb_dynres', 'dynres', true\);/)
    expect(rendererSrc).toMatch(/logarithmicDepthBuffer: LOGDEPTH/)
    // logdepthbuf_vertex 调用 isPerspectiveMatrix（定义在 <common>）：自定义 vertex
    // shader 必须 include <common>，否则 GLSL 编译失败、材质整片不渲染
    const billboard = matSrc.slice(matSrc.indexOf('function makeBillboardMaterial'))
    expect(billboard).toMatch(/#include <common>/)
    expect(billboard).toMatch(/#include <logdepthbuf_pars_vertex>/)
    expect(billboard).toMatch(/#include <logdepthbuf_vertex>/)
    expect(billboard).toMatch(/#include <logdepthbuf_pars_fragment>/)
    expect(billboard).toMatch(/#include <logdepthbuf_fragment>/)
    const ground = gpSrc.slice(gpSrc.indexOf('export function groundShaderMaterial'), gpSrc.indexOf('export function', gpSrc.indexOf('export function groundShaderMaterial') + 10))
    expect(ground).toMatch(/#include <common>/)
    expect(ground).toMatch(/#include <logdepthbuf_pars_vertex>/)
    expect(ground).toMatch(/#include <logdepthbuf_vertex>/)
    expect(ground).toMatch(/#include <logdepthbuf_pars_fragment>/)
    expect(ground).toMatch(/#include <logdepthbuf_fragment>/)
  })

  it('天空穹：unlit + 无限远方向投影 + 不写深度/不参与雾（此前整节点隐藏）', () => {
    // 回归：`o.visible = false` 把天穹整节点藏掉 → 背景只剩纯色 0x11161d（抬头没有天）。
    // 客户端 skyobject-materials-vp.sl：`mul(float4(position.xyz, 0.0), worldViewProjMatrix)`
    // —— w=0 丢弃平移，网格坐标本身就是方向（实测多数图天穹网格半径仅 ~10m，当普通几何
    // 渲染就是地图中心一个小球），深度靠 w 偏置推到最后，着色器无任何光照项。
    expect(src).not.toMatch(/o\.visible = false/);
    // 2026-10-14 抽层：天空分派在共享装配模块（asmSrc），运行时与烘焙同一份
    // 路由半句（extras.sky → makeSkyMaterial + frustumCulled=false + water-first）与
    // isSkyShell 判据 2026-11-12 接替：sceneryMaterials.materials.test.ts 行为测试
    //（sky 路由 + SkySeaSurface 水材质优先 + skyMeshes 计数）；bake 侧 SSOT 子句保留
    // 烘焙先剔天穹再装配：必须把剔除前的标记传进去，否则会退回 /sky/ 名字
    const bakeSkySrc = readSrc(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'))
    expect(bakeSkySrc).toMatch(/assembleSceneryMaterials\(gltf, \{[\s\S]{0,500}skyFlagsAvailable,/)
    // 合批/透明/lm 与运行时同口径；烘焙同样拒绝不完整变体映射
    expect(mapAssetsSrc).toMatch(/buildStandaloneLightmappedMeshes\(allEntries/)
    expect(bakeSkySrc).toMatch(/buildStandaloneLightmappedMeshes\(allEntries/)
    expect(bakeSkySrc).toMatch(/hasTransparentMaterial\(e\.material\)/)
    expect(bakeSkySrc).toMatch(/variantMappingIncomplete === true/)
    expect(bakeSkySrc).not.toMatch(/\/sky\/i\.test\(e\.name/)
    const bakeFlagAt = bakeSkySrc.indexOf('sceneHasSkyFlags(gltf.scene)')
    const bakePruneAt = bakeSkySrc.indexOf('pruneForeignVariantsDetailed(gltf.scene')
    expect(bakeFlagAt).toBeGreaterThan(-1)
    expect(bakePruneAt).toBeGreaterThan(bakeFlagAt)
    // fail-closed 变体裁剪必须中止本图烘焙，不能继续写不完整俯视图
    expect(bakeSkySrc).toMatch(/variantPrune\.failClosed[\s\S]{0,200}throw new Error/)
    const skyStart = matSrc.indexOf('export function makeSkyMaterial');
    const sky = matSrc.slice(skyStart, matSrc.indexOf('export function', skyStart + 10));
    expect(sky).toMatch(/vec4\(position, 0\.0\)/);                  // w=0：丢弃平移
    expect(sky).toMatch(/gl_Position = vec4\(p\.xy, p\.w, p\.w\);/); // 深度钉远平面
    expect(sky).toMatch(/depthWrite: false,/);
    expect(sky).toMatch(/fog: false,/);                             // 客户端 flags VERTEX_FOG:0
    expect(sky).toMatch(/side: THREE\.DoubleSide,/);                // 客户端 cullMode NONE
    expect(sky).toMatch(/THREE\.NoColorSpace/);                     // 伽马直通（同叶卡/ST| 口径）
    expect(sky).not.toMatch(/lambert/i);                            // unlit：不得引光照材质/块
    // 不挂 logdepthbuf：depthWrite=false 且 z/w=1（远平面），1.0 在线性/对数深度域都表示
    // 远平面，挂上反而把一个不存在的 gl_FragDepth 写回语义搞混
    expect(sky).not.toMatch(/logdepthbuf/);
  });

  it('场景 GLB 贴图各向异性随画质档（此前场景侧漏设=默认 1，掠射角发糊闪烁）', () => {
    expect(mapAssetsSrc).toMatch(/const aniso = Math\.min\(Q\.anisotropy, ctx\.renderer\.capabilities\.getMaxAnisotropy\(\)\);/);
    expect(mapAssetsSrc).toMatch(/applyMaterialTextureAnisotropy\(gltf\.scene, aniso\)/);
    // 枚举体行为（uniform 纹理 + 同贴图 uuid 去重只设一次）2026-11-12 接替：
    // sceneryMaterials.materials.test.ts 行为测试（applyMaterialTextureAnisotropy(root, N)）
  });

  it('场景材质用几何 authored 法线（不设 flatShading——旧行为把它整条丢掉）', () => {
    // 导出器 v0.4.1 起随导 authored 法线（fail-closed：条数对齐 + 中位模长 1±10%），
    // 前端 flatShading=true 会让渲染器改由屏幕导数现算面法线 → 导出侧工作全部作废、
    // 硬边与烘焙法线被抹平。内核与俯视烘焙页（同一 SSOT 约定）都不得再设。
    expect(src).not.toMatch(/flatShading/);
    // 烘焙页同口径读法：先剥注释（注释里会提到反例写法，不得算作代码）
    const bakeSrcNormals = readSrc(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'), 'utf8')
      .replace(/\/\/[^\n]*/g, '');
    expect(bakeSrcNormals).not.toMatch(/flatShading/);
  });

  it('俯视烘焙页消费同一装配 SSOT：convMat/键指纹/分派只有一处实现（两侧无本地副本）', () => {
    // bake-ground-overhead 的俯视烘焙以 3D 档观感为基准——材质实现与键指纹
    // 若与内核漂移，同一材质在两侧会拆成不同实例/不同观感。
    // 2026-10-14 抽层后两侧都消费 sceneryAssembly.js（convMat 唯一实现在 asmSrc），
    // 逐字比对具体键组成既无对象也无可比副本——改为锁"单实现 + 两侧都消费 + 无本地副本"。
    const bakeSrc = readSrc(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'), 'utf8')
      .replace(/\/\/[^\n]*/g, '')
    expect(bakeSrc).toMatch(/from '\/src\/scene\/sceneryMaterials\.js'/)
    // 烘焙页消费共享装配（extras 解析 → 分派），本地不得再有 convMat/材质分派副本
    expect(bakeSrc).toMatch(/from '\/src\/scene\/sceneryAssembly\.js'/)
    expect(bakeSrc).toMatch(/resolveSceneryExtras\(gltf\)/)
    expect(bakeSrc).toMatch(/makeTexResolvers\(gltf, sceneryExtras\)/)
    expect(bakeSrc).toMatch(/assembleSceneryMaterials\(gltf, \{/)
    expect(bakeSrc).not.toMatch(/const convMat = \(m, isCard\)/)
    expect(bakeSrc).not.toMatch(/cachedSceneryMat\(/)
    // 内核侧同样只有一处消费（import 装配模块；本地不得复辟 convMat）
    expect(mapAssetsSrc).toMatch(/import \{ resolveSceneryExtras, makeTexResolvers, assembleSceneryMaterials \} from '\.\.\/sceneryAssembly\.js'/)
    expect(src).not.toMatch(/const convMat = \(m, isCard\)/)
    // 唯一实现（asmSrc）的键组成含 alphaTest/transparent（见首条用例）；此处再钉
    // "分派顺序"：water → blendByAngle → decal → lightmap → blendLayer → 水下 → convMat
    const order = ['if (ud.water && typeof ud.water === ', 'if (ud.blendByAngle) {',
      'if (ud.decal && groundLayers && o.geometry.attributes.uv1) {',
      'if (ud.lightmap !== undefined && ', 'const maskTex = ud.blendLayer ? maskTexOf(m) : null;',
      'if (uw) {', 'return convMat(m, isCard);']
    let prev = -1
    for (const anchor of order) {
      const at = asmSrc.indexOf(anchor)
      expect(at, anchor).toBeGreaterThan(prev)
      prev = at
    }
    // 装配规则 SSOT（2026-10-14 漂移事故后抽层）：两侧"剔不剔/算不算水面"委托同一规则
    // 模块（sceneryAssemblyRules.js）；烘焙旧的名字剔除口径（漂移源）不得复活
    expect(bakeSrc).toMatch(/from '\/src\/scene\/sceneryAssemblyRules\.js'/)
    expect(bakeSrc).toMatch(/const strictSurfaces = strictSurfacesOf\(gltf\.scene\)/)
    expect(bakeSrc).toMatch(/bakeDropNode\(nm, o\.material,/)
    expect(bakeSrc).not.toMatch(/\|water\|sea\|river\|lake/)
    expect(mapAssetsSrc).toMatch(/from '\.\.\/sceneryAssemblyRules\.js'/)
  })

})

describe('__hullGroup 挂点（车体 = 记录位姿；逐轮悬挂见下方「悬挂接线」组）', () => {
  it('底盘（chassis_track_*/chassis_wheel_*）与车体子树分离，挂点恒归单位；命名不符则回落整台刚体', () => {
    // 2026-10-10 回退：「根吃地形局部平面 + 车体收限幅残差」的近似已撤——车体恢复客户端同构的
    // **记录位姿**摆放（poseGlb 直摆记录 yaw/pitch/roll）；__hullGroup 仅作后续悬挂实现的挂点。
    // 2026-11-05 Wave B4B：部件收集/装配出仓 playback/glbParts.ts（playbackScene 只调 collectGlbParts）
    // 部件收集/挂点行为 2026-11-12 接替：glbParts.test.js（__hullGroup 拆分 + 底盘留根）+
    // vehicleRuntime.pose.test.ts（GLB/低模两条路径 hullGroup 恒归单位）
    // 旧近似整段移除：内核不得再出现地形局部平面/限幅残差解算（准备件留在 glbRig.js，未接线）
    expect(vehSrc).not.toMatch(/terrainPitchRoll/)
    expect(vehSrc).not.toMatch(/clampHullAttitude/)
    expect(vehSrc).not.toMatch(/poseLocalBetween/)
    // 低模侧挂点：履带盒留组根、hull/grille/turretG 收进同名 hullGroup
    expect(vehSrc).toMatch(/const hullG = new THREE\.Group\(\); hullG\.name = '__hullGroup';/)
    expect(vehSrc).toMatch(/hullGroup: hullG,/)
  })
})

describe('悬挂接线（轮/带逐帧解算，客户端同构）', () => {
  it('悬挂逐帧解算宿主接线（#827 F3：无注入点）：markSeekSnap → tick → clearSnap、frameTiming 喂帧', () => {
    // 模块语义（frameTiming 两帧积分 / markSeekSnap 跳变吸附不积累侧位移 / 不可见复位）
    // 2026-11-12 接替：vehicleRuntime.pose.test.ts 行为测试（真实 createVehicleRuntime harness）
    expect(src).toMatch(/vehicles\.markSeekSnap\(\);[\s\S]{0,160}tick\(\);/)
    expect(src).toMatch(/for \(const v of vehicles\.getVehicles\(\)\) vehicles\.applyPose\(v\);[\s\S]{0,80}vehicles\.clearSnap\(\);/)
    expect(src).toMatch(/vehicles\.frameTiming\(dt, false\);[\s\S]{0,80}tick\(\);/)
  })


  it('只动底盘节点（chassis_wheel_* / chassis_track_*）：轮数/链数不符即 fail-closed', () => {
    // fail-closed（轮/链数不符 → null）与 per-vehicle clone 2026-11-12 接替：
    // vehicleRuntime.pose.test.ts 行为测试（mismatch fixture / 两车 geometry !==）
    // 轮自转必须走 pivot 补偿：导出器把轮几何烘进顶点、节点留在原点 —— 直接写旋转 =
    // 轮绕整车公转（实测轮心漂 5.4~6.8 m，观感"旋转混乱"）
    expect(vehSrc).toMatch(/applyWheelSpin\(w\.node, w\.restPos, w\.restQuat, w\.pivot, w\.restPivotRot,/)
    expect(vehSrc).toMatch(/node\.parent\.worldToLocal\(ctr\.clone\(\)\)/)
  })

})

describe('播放时钟与速度档位（对齐上游的纯函数入口）', () => {
  it('推进走 advancePlaybackTime（NaN/负增量不污染时钟），终点钳制仍生效（#827 F3：宿主接线子句；纯函数行为见 playback/util.behavior.test.ts）', () => {
    expect(src).toMatch(/T = advancePlaybackTime\(T, END, dt \* 1000, SPEED\);/)
    expect(src).not.toMatch(/T \+= dt \* SPEED;/)
  })

  it('setSpeed 只接受档位表内的值（#827 F3: Integration Contract（无注入点）；宿主闭包函数无独立 owner）', () => {
    expect(src).toMatch(/function setSpeed\(s\) \{ if \(!isPlaybackSpeed\(s\)\) return;/)
  })

  it('onResize 单画布取整尺寸 + 置脏重绘（#827 F3: Integration Contract（无注入点）；宿主闭包函数）', () => {
    const resize = src.slice(src.indexOf('function onResize'), src.indexOf('function onScenePointerDown'))
    expect(resize).toMatch(/const w = Math\.max\(1, Math\.round\(container\.clientWidth\)\);/)
    expect(resize).toMatch(/renderer\.setSize\(w, h\);/)
    expect(resize).toMatch(/invalidate\(\);/)
    expect(resize).not.toMatch(/labelRenderer/)
  })

  it('覆盖层并入主画布：不再有第二个 WebGL 上下文，也没有第二次 render', () => {
    // 回归：独立标签画布 = 两块 GPU 表面 + 浏览器逐帧两画布合成。
    // 伤害数字迁到 HTML 覆盖层后，反馈层不再需要 renderer 的第二次 render。
    expect(src).not.toMatch(/labelRenderer/)
    // 渲染器创建 2026-10-24 出仓 playback/renderer.js（Step A2）：仍全仓（src+创建核心）恰一个 WebGL 上下文
    const rendererSrc = readSrc(resolve(here, 'playback/renderer.ts'), 'utf8')
    const ctor = [...(src.match(/new THREE\.WebGLRenderer\(/g) || []), ...(rendererSrc.match(/new THREE\.WebGLRenderer\(/g) || [])]
    expect(ctor.length).toBe(1)
    const animate = src.slice(src.indexOf('function animate()'))
    expect(animate).toMatch(/renderer\.render\(scene, camera\);/)
    expect(animate).not.toMatch(/autoClear/)
  })

  it('特效走对象池：到期归池而非 dispose，池只在会话结束时整体释放', () => {
    // 回归：每发/每次命中/每次击毁新建 geometry+material 再 dispose → 交火高峰分配尖峰。
    // 炮线/光迹借还 battleFx 的条带池，命中/开火/爆炸写进 battleFx 的粒子批次
    //（资源唯一 owner 与释放见 battleFx.test.js）；伤害数字已是覆盖层 DOM，没有画布资源可池化。
    // 炮线/光迹借还 battleFx 的条带池（takeRibbon ≥ shots、完成归还、热路径零 dispose）
    // 2026-11-12 接替：battleRuntime.fx.test.ts 行为测试（真实 createBattleRuntime harness）
    expect(src).toMatch(/battle\.dispose\(\);/)
  })

  /**
   * 装填条求值门控：3D 标签改为 HTML 覆盖层后，求值从"每车 sprite 重绘"变成
   * `publishLabels` 的节流快照。两条不变量不变：
   *   1. 关标签时整段不做（`store.labelsOn` 早退）；
   *   2. 暂停 / T 未变时不重复求值（时间戳门控）。
   */
  it('装填条求值：关标签或 T 未变时跳过（暂停/关标签不再每车每帧全量求值）', () => {
    // 发布门控行为（关标签早退 / 同 T 只求值一次 / 节流窗）2026-11-12 接替：
    // labelsRuntime.gating.test.ts 行为测试（真实 createLabelsRuntime harness）
    // 动态节流（2026-10-05）：装填中 33ms（~30Hz，进度平滑）/ 空闲 100ms。
    expect(lblSrc, '装填中 33ms').toMatch(/const LABEL_INTERVAL_RELOAD_MS = 33;/)
    expect(lblSrc, '空闲 100ms（原值）').toMatch(/const LABEL_INTERVAL_IDLE_MS = 100;/)
  })

  it('HUD 降频：store.time/seekFrac 不再每帧写，seek 时强制补一次（#827 F3: Integration Contract（无注入点））', () => {
    expect(src).toMatch(/const HUD_INTERVAL_MS = 100;/)
    expect(src).toMatch(/function writeHud\(force = false\)/)
    expect(src).toMatch(/writeHud\(true\);/)
    const tick = src.slice(src.indexOf('function tick()'), src.indexOf('function writeHud'))
    expect(tick).not.toMatch(/store\.time = T;/)
  })

  it('资产加载走有限并发（地表贴图 / 坦克 GLB 都受上限约束）', () => {
    // 并发工具行为（在飞 ≤4、保序）2026-11-12 接替：playback/util.behavior.test.ts
    expect(mapWorldSrc).toMatch(/await mapLimit\(need, ASSET_CONCURRENCY/)
    expect(vehSrc).toMatch(/await mapLimit\(V\.filter\(v => v\.def\.tank_id > 0\), ASSET_CONCURRENCY/)
  })

  it('GLB 位姿零分配：poseFromYPR 支持 out 参数，poseGlb 用模块级 scratch', () => {
    // 回退后（记录位姿）：根 = 记录 yaw/pitch/roll 一次合成，无高度场参与
    // 纯姿态 poseGlbRig(v, t, pos)：每帧以 (T, 本帧位置) 调用；开火定位炮口时临时以 t_fire 调用再摆回
    // poseFromYPR out 参数零分配 2026-11-12 接替：vehicleRuntime.pose.test.ts 行为测试
    expect(vehSrc).toMatch(/v\.glb\.position\.copy\(pos\);/)
    expect(vehSrc).toMatch(/poseGlbRig\(v, deps\.getT\(\), v\.group\.position\);\s*suspensionStep\(v\);/)
    const glb = vehSrc.slice(vehSrc.indexOf('function poseGlb'), vehSrc.indexOf('async function applyGlbToggle'))
    expect(glb).not.toMatch(/terrainPitchRoll|clampHullAttitude|sampleHeight/)
    expect(glb).not.toMatch(/new THREE\.Matrix4\(\)/)     // 每帧不再新建矩阵
    expect(glb).not.toMatch(/new THREE\.Euler\(\)/)
    expect(glb).toMatch(/_mAcc\.copy\(mT\)\.multiply\(tn\.userData\.__bake as THREE\.Matrix4\)/)
    // bake 捕获的 clone 是一次性（userData.__bake），不属于逐帧分配
  })

  it('按需渲染：脏帧判定覆盖播放/相机/特效/幽灵闪，跳帧时不跑更新与 render', () => {
    const animate = src.slice(src.indexOf('function animate()'))
    expect(animate).toMatch(/const busy = PLAYING/)
    expect(animate).toMatch(/\|\| cameraMoved/)
    expect(animate).toMatch(/\|\| frameDirty/)
    // 弹道/战斗特效/幽灵闪的活跃判定由 battleRuntime 持有，场景只问 battle.isActive()
    expect(animate).toMatch(/\|\| battle\.isActive\(\);/)
    // isActive() 真值表 2026-11-12 接替：battleRuntime.fx.test.ts 行为测试
    // 跳帧分支：空闲时只做帧率角标归零，随后 return（不跑 tick / 标签 / render）
    expect(animate).toMatch(/if \(!busy\) \{(?:.|\n){0,600}?return;/)
    expect(animate.indexOf('frameDirty = false;')).toBeGreaterThan(animate.indexOf('if (!busy) {'))
  })
})

describe('车体横滚（hull_roll）接线守卫', () => {
  // 位姿采样 SSOT（2026-10-16 抽层：2D 俯视与 3D 场景共用同一实现，见 vehiclePose.ts 头部）。
  // 通道选择 / 缺列兜底随实现迁移到该模块，守卫改读新源（与 matSrc/asmSrc/gpSrc 同例）。
  const poseSrc = readSrc(resolve(here, '../replay-local/pose/vehiclePose.ts'), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  it('侧倾取值走共享位姿采样器：旧产物缺列时落 0（不拿 pitch 顶替）', () => {
    // rollAt 经每车最近采样缓存（poseStash）读 .roll；poseStash 内部仍走共享采样器 poseOf
    //（下一断言），缓存不改变通道选择的 SSOT 归属。
    expect(vehSrc).toMatch(/const rollAt = \(v: RuntimeVehicle, t: number\) => poseStash\(v, t\)\.roll;/)
    // 缺列落 0（gridChannel）/ 侧倾与炮塔只有网格列 2026-11-12 接替：
    // vehicleRuntime.pose.test.ts 行为测试（sampleVehiclePoseGame 缺 hull_roll → out.roll===0）
  })

  it('位姿通道唯一实现：场景只做帧变换，不再自带通道选择/关键帧回退', () => {
    // 2D 俯视与 3D 场景必须逐帧同源（2026-10-16 抽层）；本守卫防通道逻辑回流到场景侧。
    // 通道选择/AoI 覆盖回退行为 2026-11-12 接替：vehicleRuntime.pose.test.ts
    //（visByEid 覆盖段钳位 / coverage 回退插值）
    expect(vehSrc).toMatch(/out\.set\(-p\.x, p\.y, p\.z\);/)
    expect(vehSrc).not.toMatch(/kfOf/)
    expect(vehSrc).not.toMatch(/const col = \(c\) =>/)
  })

})

describe('炮线渲染守卫（阵营语义色直出）', () => {
  it('飞行段时长 = 真实飞行时长（不得再有"最小显示时长"拖慢炮弹）', async () => {
    const { tracerSpanSecs } = await import('./playback/pure.js')   // owner 模块（façade 只 re-export；直连避免重型 import 超时）
    // 真实弹道时长原样返回（WoTB 弹速极高：多数射击飞行 <0.22s，钳到 0.22 就是慢放）
    expect(tracerSpanSecs(0.44)).toBeCloseTo(0.44, 12)
    expect(tracerSpanSecs(0.16)).toBeCloseTo(0.16, 12)
    expect(tracerSpanSecs(0.02)).toBeCloseTo(0.02, 12)
    // 只有 1 帧下限兜底退化数据（0 / 负数 / 非有限），且不再有 0.22s 这类"可见性下限"
    const oneFrame = 1 / 60
    expect(tracerSpanSecs(0)).toBeCloseTo(oneFrame, 12)
    expect(tracerSpanSecs(-1)).toBeCloseTo(oneFrame, 12)
    expect(tracerSpanSecs(NaN)).toBeCloseTo(oneFrame, 12)
    expect(tracerSpanSecs(Number.POSITIVE_INFINITY)).toBeCloseTo(oneFrame, 12)
  })

  it('标记/反馈层材质字面色直出（toneMapped:false）——逐图曝光不得压深 UI 语义色', () => {
    // 2026-10-11 用户报"作者圆环 / 地图边界红线在加了光照后变深"：逐图曝光
    // （toneMappingExposure = 基准太阳强度/该图强度）经 three 内建通路作用于**一切未排除
    // 的材质**，未设 toneMapped:false 的标记材质会随图变深（山地图 expo≈0.21）。
    // 炮线/轨迹线早已遵循此约定（见其注释），本守卫把同类标记逐点锁死。
    // 击毁特效的 toneMapped 在 playbackScene 生命周期测试中检查实际材质。
    // 边界带/基地环/圆盘 toneMapped:false 2026-11-12 接替：
    // playback/markers.toneMapped.test.ts 行为测试（createBoundaryBand/createBaseMarkers 真实材质）
    const sites = [
      [/color: 0xe8b23c[\s\S]{0,160}toneMapped: false/, '作者标记环'],
    ]
    for (const [re, label] of sites) expect(vehSrc, label).toMatch(re)
    // 炮线 / 光迹 / 命中 / 开火 / 爆炸的材质在 battleFx：其 toneMapped=false 由 battleFx.test.js 按真实材质断言
  })

  it('着色器预热：场景就绪时 compile 一次（首次开火才编译＝开局/接火卡顿）', () => {
    expect(src).toMatch(/function prewarmShaders\(\)/)
    expect(src).toMatch(/renderer\.compile\(scene, camera\);/)
    // 会话启动路径必须调用（GLB 恢复之后、开播之前）
    // GLB 恢复挂载已前移到 buildVehicles 之后（2026-10-11）：高/极致在 assetStage 内
    // await 全部模型就绪才开播（用户裁示"进地图前加载完双方坦克模型"）
    // 会话启动时序（applyGlbToggle → buildRoster → prewarmShaders 恰一次 → setPlaying）
    // 2026-11-12 接替：sessionLifecycle.prewarm.test.ts 行为测试（真实 createSessionLifecycle）
    expect(src).toMatch(/prewarmShaders,/)
  })

})

describe('disposeSceneGroup —— 双图资源生命周期（评审 P2）', () => {
  // 烘焙页 --all 在同一 renderer 里逐图运行：共享 SpeedTree shader 的贴图在
  // uniforms.map.value，只枚举直接属性会漏（material dispose=1、texture dispose=0，
  // 显存随图数累积）；模块级材质缓存不清理则下一图拿到已 dispose 的失效实例。
  it('释放 uniforms 纹理与材质，并清空材质缓存使下一图拿到新实例', async () => {
    const { vi } = await import('vitest')
    const { makeBillboardMaterial, disposeSceneGroup, clearSceneryMatCache } = await import('./sceneryMaterials.ts')
    clearSceneryMatCache()
    const tex = { isTexture: true, dispose: vi.fn() }
    const gltfMaterial = { name: 'leaf', map: tex, color: { r: 1, g: 1, b: 1 }, alphaTest: 0, transparent: false, opacity: 1, vertexColors: false, userData: {} }
    const mesh1 = { isMesh: true, geometry: { dispose: vi.fn() }, material: makeBillboardMaterial(gltfMaterial) }
    const group1 = { traverse: (fn) => fn(mesh1) }
    const m1 = mesh1.material
    const spyM = vi.spyOn(m1, 'dispose')
    const spyT = vi.spyOn(tex, 'dispose')
    const stats = disposeSceneGroup(group1)
    expect(stats.materials).toBe(1)
    expect(spyT).toHaveBeenCalled()
    expect(spyM).toHaveBeenCalled()
    // 缓存已清：同输入重建得到新实例（不再复用已 dispose 的材质）
    const again = makeBillboardMaterial(gltfMaterial)
    expect(again).not.toBe(m1)
    clearSceneryMatCache()
  })
})


