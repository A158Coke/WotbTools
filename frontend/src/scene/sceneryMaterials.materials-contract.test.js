

// 场景内核依赖 WebGL，无法直接实例化；此仓已有源码级契约测试的先例（labelOcclusion.test.js）。
// 本文件守卫「场景 GLB 材质管线」，即本轮从上游补齐的渲染实现——它们此前在本仓缺失，
// 且都属于"少一行就退化成逐 mesh 建材质 / 透明队列闪烁"的接线型不变量。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const readSrc = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const src = readSrc(resolve(here, 'playbackScene.js'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const mapAssetsSrc = readSrc(resolve(here, 'playback/mapAssets.ts'), 'utf8')
const matSrc = ['sceneryMaterials.ts', 'sceneryLightingMaterials.ts', 'sceneryWaterMaterials.ts', 'scenerySurfaceMaterials.ts'].map(path => readSrc(resolve(here, path), 'utf8')).join('\n')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const asmSrc = readSrc(resolve(here, 'sceneryAssembly.ts'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const mapWorldSrc = stripComments(readSrc(resolve(here, 'playback/mapWorld.ts')))
const matDisposeSrc = stripComments(readSrc(resolve(here, 'materialDispose.ts')))

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
    expect(fn).not.toMatch(/albedoTex|decalTex|uReflectance\b|uDecalTint/);          // LOW 档字段零残留
    // HIGH/ULTRA 太阳高光：客户端 SPECULAR 分支（lighting.slh BlinnPhong 公式）
    expect(fn).toMatch(/pow\(5000\.0, uGlossiness\)/);
    expect(fn).toMatch(/uSunSpecColor \* specTerm \* \(NdotL \* uSpecularity \* F\)/);
    // 装配路由（water extras → makeWaterMaterial）行为测试见 sceneryMaterials.materials.test.ts；
    // 水面共面合并缓存键与冻结登记仍由装配模块锁定。
    expect(asmSrc).toMatch(/cachedSceneryMat\(\s*\['W', m\.uuid/)
    expect(asmSrc).toMatch(/makeWaterMaterial\(m, \{/)
    expect(asmSrc).toMatch(/coast: waterCoast, wro: ud\.water,/)
    expect(asmSrc).toMatch(/u\.uTime && !\(mm\.userData && mm\.userData\.water\)/)
    expect(src).toMatch(/for \(const mm of animLayerMats\) mm\.uniforms\.uTime\.value = secs;/);
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
})
