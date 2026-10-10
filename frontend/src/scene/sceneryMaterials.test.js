import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// 先剥注释：断言只看代码，注释里提到的反例写法（如 "写成 userData.extras.occMean 会…"）
// 不得影响判据。
const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
// 材质实现（billboard/speedtree/缓存/常量/isWaterName）已平移至专用模块（SSOT，
// bake-ground-overhead 烘焙页共用同一实现），守卫随迁读取新源
const matSrc = readFileSync(resolve(here, 'sceneryMaterials.js'), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

// 场景内核依赖 WebGL，无法直接实例化；此仓已有源码级契约测试的先例（labelOcclusion.test.js）。
// 本文件守卫「场景 GLB 材质管线」，即本轮从上游补齐的渲染实现——它们此前在本仓缺失，
// 且都属于"少一行就退化成逐 mesh 建材质 / 透明队列闪烁"的接线型不变量。
describe('场景 GLB 材质管线（对齐上游的渲染实现）', () => {
  it('材质实例按 key 去重：convMat 经 cachedSceneryMat，键含 alphaTest/transparent', () => {
    // 回归：逐 mesh 各建一份材质 → 材质/着色器实例与 program 切换随 mesh 数线性膨胀
    expect(src).toMatch(/const convMat = \(m, isCard\) => cachedSceneryMat\(/)
    const key = src.slice(src.indexOf('const convMat = (m, isCard) => cachedSceneryMat('))
    expect(key.slice(0, 900)).toMatch(/m\.alphaTest \?\? 0/)
    expect(key.slice(0, 900)).toMatch(/!!m\.transparent/)
    expect(key.slice(0, 900)).toMatch(/m\.map \? m\.map\.uuid : ''/)
  })

  it('disposeObject3D 经 collectMaterialTextures 回收纹理（含 ShaderMaterial uniforms）', () => {
    // 回归：ST| 静态 ShaderMaterial 的纹理在 uniforms.map.value，直接属性枚举
    // 触发零次 dispose → 切图累积 GPU 显存
    expect(src).toMatch(/import \{ collectMaterialTextures \} from '\.\/materialDispose\.js'/)
    const at = src.indexOf('function disposeObject3D')
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at, at + 900)).toMatch(/collectMaterialTextures\(m, texs\)/)
  })

  it('材质缓存随会话释放（勿复用已 dispose 实例）', () => {
    // 必须在 teardownSession 里清空——mapScenery 在同一段被 dispose，缓存留着就会
    // 复用已释放的材质实例
    const at = src.indexOf('function teardownSession')
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at, at + 4000)).toMatch(/clearSceneryMatCache\(\);/)
  })

  it('叶卡走不透明管线：transparent=false + uAlphaCut discard（消除互遮挡闪烁）', () => {
    // 回归：transparent=true + depthWrite=true 二者冲突 → 叶片互相遮挡破洞/闪烁
    expect(matSrc).toMatch(/const CARD_ALPHA_CUT = 0\.33/)
    const billboard = matSrc.slice(matSrc.indexOf('function makeBillboardMaterial'))
    expect(billboard).toMatch(/uAlphaCut: \{ value: CARD_ALPHA_CUT \}/)
    expect(billboard).toMatch(/if \(c\.a < uAlphaCut\) discard;/)
    expect(billboard).toMatch(/transparent: false,/)
  })

  it('叶卡材质取自身 occMean 与 SH 染色（不硬编码 1.77、不读 extras）', () => {
    const billboard = matSrc.slice(matSrc.indexOf('function makeBillboardMaterial'))
    expect(billboard).toMatch(/Number\(m\.userData\.occMean\)/)
    expect(billboard).not.toMatch(/userData\.extras/)
    expect(billboard).toMatch(/uSH: \{ value: shTint \}/)
    expect(billboard).not.toMatch(/uSH: \{ value: 1\.77 \}/)
  })

  it('伪透明转不透明 + 裁切，真透明不写深度', () => {
    // 判据含 !blendLayer/!softAlpha：导出器标记的软混合层（烟雾/瀑布 extras.blendLayer、
    // 视角淡出片 extras.alphaBlend）都不走这条分流，保留软 alpha
    expect(src).toMatch(/const pseudoOpaque = !!m\.transparent && \(m\.opacity \?\? 1\) >= 0\.99 && !blendLayer && !softAlpha;/)
    expect(src).toMatch(/transparent: !!m\.transparent && !pseudoOpaque,/)
    expect(src).toMatch(/if \(pseudoOpaque\) nm\.alphaTest = Math\.max\(nm\.alphaTest \|\| 0, 0\.33\);/)
    expect(src).toMatch(/if \(nm\.transparent\) nm\.depthWrite = false;/)
    // 镂空贴图必须继承 GLTFLoader 解析好的 alphaTest（MASK 裁切，否则整片方片照绘）
    expect(src).toMatch(/if \(m\.alphaTest > 0\) nm\.alphaTest = m\.alphaTest;/)
  })

  it('真混合层（extras.blendLayer）保留软 alpha：不被伪透明分流削成硬边卡片', () => {
    // 回归：导出器标记的混合层（烟雾/瀑布/浪 = 动画 + 掩码）其 alpha 是掩码烘出的软渐变，
    // "BLEND 但不透明度≈1 → 转不透明 + alphaTest 0.33"会把霾削成硬边卡片
    //（2026-10-09 himmelsdorf 烟囱烟雾报障：掩码单通道值一度烘成二值剪影）。
    expect(src).toMatch(/const blendLayer = !!\(m\.userData && m\.userData\.blendLayer\);/);
    expect(src).toMatch(/const pseudoOpaque = !!m\.transparent && \(m\.opacity \?\? 1\) >= 0\.99 && !blendLayer && !softAlpha;/);
    // 材质缓存键必须含该标记（否则同 name+map 的两种材质会串用，先建的赢）
    expect(src).toMatch(/\(m\.userData && m\.userData\.alphaBlend\) \|\| '',/);
    // 俯视烘焙页与内核同约定（SSOT 守卫：两侧键指纹与分流口径逐字一致）
    const bakeSrcBlend = readFileSync(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'), 'utf8');
    expect(bakeSrcBlend).toMatch(/userData\.blendLayer/);
    expect(bakeSrcBlend).toMatch(/>= 0\.99 && !blendLayer && !softAlpha;/);
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
    // 装配：掩码贴图经 GLTFLoader associations 预解析（texture 依赖异步、遍历同步）
    expect(src).toMatch(/getDependency\('texture', ex\.maskTexture\)/)
    expect(src).toMatch(/if \(maskTex && o\.geometry\.attributes\.uv1\) return makeBlendLayerMaterial\(m, maskTex\);/)
    // 逐帧写 uTime（回放秒数）：暂停即停、seek 后相位确定
    expect(src).toMatch(/for \(const mm of animLayerMats\) mm\.uniforms\.uTime\.value = secs;/)
    expect(src).toMatch(/const secs = T \/ 1000;/)
    expect(src).toMatch(/animLayerMats = \[\];/)
  })

  it('坦克 GLB 失败必须留痕（禁止静默 catch）+ 部位不全保持代理车', () => {
    // 回归：loadGlb 原为 `catch { return null }` —— 404/解析异常/模板处理抛错全被吞，
    // "切真实车模后没有车"无从定位（2026-10-09 实测）。失败要带 tank_id 与原始错误。
    expect(src).toMatch(/console\.warn\('\[playback\] 坦克 GLB 加载失败 tank_id=' \+ tankId \+ ':', e\)/)
    expect(src).not.toMatch(/\} catch \{ return null; \}/)
    expect(src).toMatch(/console\.warn\('\[playback\] 坦克 GLB 解析返回空 tank_id=' \+ tankId\)/)
    // 部位/枢轴链不全 → 不挂半装载的 GLB（会停在世界原点被地形埋住），保留代理车
    expect(src).toMatch(/console\.warn\('\[playback\] GLB 部位不全，保留代理车 tank_id=' \+ v\.def\.tank_id\)/)
    // 顺序：先过部位检查、再落 v.glb（注释被剥，故用区间顺序断言）
    const blk = src.slice(src.indexOf('if (loaded && glbOn && !v.glb) {'), src.indexOf('scene.add(v.glb);'))
    expect(blk.indexOf('collectGlbParts(')).toBeGreaterThan(-1)
    expect(blk.indexOf('collectGlbParts(')).toBeLessThan(blk.indexOf('v.glb = inst;'))
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
    // 共享太阳 uniform（lightColor0 = color×intensity；playbackScene 换图时更新）
    expect(src).toMatch(/sunUniforms\.uSunDirScene\.value\.set\(d\[0\] \/ n/);
    expect(src).toMatch(/sunUniforms\.uSunColor\.value\.set\(sun\.color\[0\] \* sun\.intensity/);
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
    // 接线：水面数据经同一趟预解析；旧包（water 仅 bool）回落 convMat + 水面修整分支。
    expect(src).toMatch(/getDependency\('texture', ex\.water\.normal\)/);
    expect(src).toMatch(/if \(ud\.water && typeof ud\.water === 'object'\) \{/);
    expect(src).toMatch(/return makeWaterMaterial\(m, \{ normalTex: wt\[0\], cubeTex: wt\[1\], props: ud\.water\.props \|\| \{\}, coast: waterCoast \}\);/);
    // 回放时钟驱动：uTime（混合层的 uShiftRate、水面的 uShift0/1 都吃同一个时钟）
    expect(src).toMatch(/if \(mm && mm\.uniforms && mm\.uniforms\.uTime\) animLayerMats\.push\(mm\);/);
  })

  it('逐图 IBL：等距柱状环境贴图 + 倍率 + 时序守卫 + 会话释放', () => {
    // 客户端 IBLComponent：specular 立方图 → 上游转等距柱状（tools/export_map_ibl.py）。
    // 只影响 glTF PBR 材质（坦克）；自定义 ShaderMaterial 不吃 environment。
    const rs = readFileSync(resolve(here, 'replaySource.js'), 'utf8')
    expect(rs).toMatch(/case 'ibl': return f\('ibl\.webp'\)/)
    expect(src).toMatch(/tex\.mapping = THREE\.EquirectangularReflectionMapping;/)
    expect(src).toMatch(/tex\.colorSpace = THREE\.SRGBColorSpace;/)
    expect(src).toMatch(/scene\.environmentIntensity = envMultiplier;/)
    // 倍率来自 lighting.json 的 ibl.environmentMultiplier（逐图 0.8–4.0）
    expect(src).toMatch(/envMultiplier = Number\.isFinite\(m\) \? m : 1;/)
    // 时序：资产阶段可早于 initScene（scene 未创建）→ 加载时判空 + initScene 末尾补挂
    expect(src).toMatch(/if \(scene\) \{/)
    expect(src).toMatch(/scene\.environment = tex;/)
    expect(src).toMatch(/if \(envTexture\) \{/)
    // 会话拆除：摘环境 + dispose（PMREM 缓存随纹理释放）
    expect(src).toMatch(/scene\.environment = null;/)
    expect(src).toMatch(/if \(envTexture\) \{ envTexture\.dispose\(\); envTexture = null; \}/)
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
    // 接线：图集经同一趟预解析；水/天空/水下件不接（水下件见下条用例：客户端折射通道口径）
    expect(src).toMatch(/getDependency\('texture', ex\.lightmap\)/)
    expect(src).toMatch(/if \(ud\.lightmap !== undefined && !isWaterNode\(o\.name, m\) && !\/sky\/i\.test\(o\.name \|\| ''\)/)
    expect(src).toMatch(/\n\s*&& !underWater\(o\)\) \{/)
    expect(src).toMatch(/if \(atlas && o\.geometry\.attributes\.uv1\) \{/)
    expect(src).toMatch(/return makeLightmappedMaterial\(m, atlas,/)
    // 环境反射：判据是**绑了掩码+立方图两个槽**（旗标只在部分实例上，不可作判据）
    expect(src).toMatch(/et \? \{ maskTex: et\[0\], cubeTex: et\[1\], props \} : null,/)
    expect(src).toMatch(/getDependency\('texture', ex\.envCube\)/)
    // 逐实例属性：薄包装几何（属性对象原样引用，零重复上传），不得用 geometry.clone()
    const instSrc = readFileSync(resolve(here, 'sceneryInstancing.js'), 'utf8')
    expect(instSrc).toMatch(/lm: \(node\.userData && Array\.isArray\(node\.userData\.lm\)\) \? node\.userData\.lm : null,/)
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
    // 接线：extras.detail → 依赖预解析 → lightmapped 分支实参；非光照图批次走 Lambert 补丁
    expect(src).toMatch(/getDependency\('texture', ex\.detail\.texture\)/);
    expect(src).toMatch(/const detailTexOf = \(m\) => texOf\(m, detailTexByMatIndex\);/);
    expect(src).toMatch(/dtex \? \{ tex: dtex, scale: ud\.detail\.scale \} : null\);/);
    expect(src).toMatch(/patchSceneryDetail\(nm, dtex, m\.userData\.detail\.scale\);/);
    // convMat 缓存键含 detail 身份（贴图 uuid + scale），否则同图不同砖纹串用
    expect(src).toMatch(/const t = detailTexOf\(m\);/);
    expect(src).toMatch(/return 'D\|' \+ \(t \? t\.uuid : ''\) \+ '\|'/);
    // Lambert 补丁本体：注入点 + program 缓存键标记（与坦克补丁同法，防串用未打补丁程序）
    const pat = matSrc.indexOf('export function patchSceneryDetail');
    const pfn = matSrc.slice(pat, matSrc.indexOf('export function', pat + 10));
    expect(pfn).toMatch(/diffuseColor\.rgb \*= texture2D\(uDetailTex, vDetailUv\)\.rgb \* 2\.0;/);
    expect(pfn).toMatch(/\|scenery-detail/);
    // 烘焙页：键同构 + detailTexOf 桩（细节层不进俯视底图——该页不做 extras 贴图解析）
    const bake = readFileSync(resolve(here, '../../scripts/bake-ground-overhead.mjs'), 'utf8')
    expect(bake).toMatch(/const detailTexOf = \(\) => null;/);
  })

  it('逐图太阳：lighting.json 驱动方向/色/强度与半球环境色，缺失回落兜底', () => {
    // 回归：目标光是硬编码的 (120,260,80)，与各图真实太阳无关——用 authored 法线后
    // 定向光真正塑形，错方位立刻显形（面向太阳的面反而暗，2026-10-09 用户报障）。
    const rs = readFileSync(resolve(here, 'replaySource.js'), 'utf8')
    expect(rs).toMatch(/case 'lighting': return f\('lighting\.json'\)/)
    expect(src).toMatch(/applyMapLighting\(L\)/)
    const fnStart = src.indexOf('function applyMapLighting');
    const fn = src.slice(fnStart, src.indexOf('function resetMapLighting'));
    // 客户端给"传播方向"，three 的方向光从 position 射向 target ⇒ position = −direction
    expect(fn).toMatch(/sunLight\.position\.set\(-d\[0\] \/ n, -d\[1\] \/ n, -d\[2\] \/ n\)/)
    expect(fn).toMatch(/sunLight\.intensity = sun\.intensity;/)
    expect(fn).toMatch(/hemiLight\.color\.setRGB\(sun\.ambient\[0\]/)
    // target 必须进场景图（否则矩阵不更新，方向滞留默认）
    expect(src).toMatch(/scene\.add\(sunLight\.target\);/)
    // 会话拆除复位，避免换图残留上一张的太阳（守卫读的是剥注释源码，别带注释）
    expect(src).toMatch(/resetMapLighting\(\);/)
  })

  it('ST| 静态几何走伽马直通 ShaderMaterial（与叶卡同方程，防同树双色）', () => {
    // 回归：MeshBasicMaterial 的 sRGB 解码→编码往返把 SH 实际压成 SH^(1/2.2)，
    // 与 billboard 叶（直通）差约 28% → 同树固定叶/billboard 叶双色（erlenberg 实测）
    const st = src.slice(src.indexOf("if ((m.name || '').startsWith('ST|'))"))
    expect(st.slice(0, 400)).toMatch(/return makeSpeedtreeStaticMaterial\(m, opaqueEnough\);/)
    const fn = matSrc.slice(matSrc.indexOf('function makeSpeedtreeStaticMaterial'))
    // 客户端同式：albedo × vOcc × SH(L0)，伽马直采直写（无 tone mapping/输出重编码）
    expect(fn).toMatch(/gl_FragColor = vec4\(c\.rgb \* \(vOcc \* uSH\), c\.a\);/)
    expect(fn).toMatch(/uAlphaCut: \{ value: opaqueEnough \? 0\.33 : 0\.05 \}/)
    expect(fn).toMatch(/transparent: !opaqueEnough,/)
    expect(fn).toMatch(/depthWrite: opaqueEnough,/)
    // vOcc 仅取 COLOR_0.r（灰度遮挡）；无 COLOR_0 的正则树干 = 1
    expect(fn).toMatch(/vOcc = \$\{hasVC \? 'color\.r' : '1\.0'\};/)
    // SH 染色逐通道来自 baseColorFactor（karelia 彩色环境/√π 灰均按字面）
    expect(fn).toMatch(/new THREE\.Vector3\(c0\.r, c0\.g, c0\.b\)/)
  })

  it('占位地面与占位网格都不参与绘制（网格压在水面 y=0.02 之上，会盖住水面）', () => {
    // buildWorld 的占位地面（深色底板，y=0）与占位网格（GridHelper，y=0.02）都落在真实
    // terrainMesh/水面同层附近：显示出来会在地图、半透明水面与地图外沿画出一层蓝灰线，
    // 并透出深色底板掩盖水的 alpha 效果。两者都必须 visible=false，对象仍保留入 scene
    //（拾取过滤/bbox 拟合按对象引用走，不看 visible）。
    expect(src).toMatch(/ground\.visible = false;/)
    const at = src.indexOf('const grid = new THREE.GridHelper(')
    expect(at).toBeGreaterThan(-1)
    const block = src.slice(at, at + 900)
    expect(block).toMatch(/grid\.visible = false;/)
    expect(block).toMatch(/scene\.add\(grid\);/)
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
    expect(fn).toMatch(/m\.envMapIntensity = TANK_ENV_INTENSITY;/)
    expect(fn).toMatch(/__tankAmbientFixed/)                       // 幂等：重复遍历不重打
    expect(fn).toMatch(/'\|tank-noambient'/)                       // 程序缓存键带标记（否则复用未打补丁程序）
    // 接线：坦克装配点（禁区外）调用；不改 scenery 侧任何材质
    expect(src).toMatch(/applyTankLightingFix\(v\.glb\);/)
    expect(src).toMatch(/import \{ applyMaterialTextureAnisotropy, applyTankLightingFix,/)
  })

  it('出屏口径（A2）：线性 × 曝光 1.0 → sRGB 编码 = 客户端口径；不引入调参旋钮', () => {
    // 客户端证据（tmp_analysis/shaders 逐行核过）：pbr-fp.sl 的 Uncharted2/Hejl 两条 filmic
    // 曲线都注释掉，生效行是注释写着 "Linear to sRGB conversion without tonemapping" 的
    // LinearToSRGB；exposure-tonemapping-fp.sl 的 `1 - exp(-x*e)` 同样注释掉，生效行是
    // `x * exposure`（线性 × 曝光）。⇒ 只允许线性档。
    expect(src).toMatch(/renderer\.toneMapping = THREE\.LinearToneMapping;/)
    expect(src).toMatch(/renderer\.toneMappingExposure = 1\.0;/)
    // 客户端的曝光是**屏幕级自动曝光**（`[auto] property float exposure`），数据面没有静态值可抄
    // ⇒ 不许引入 `?tonemap`/`?exposure` 这类"必须手工调才对"的替代参数（2026-10-10 撤除）。
    expect(src).not.toMatch(/get\('tonemap'\)|get\('exposure'\)/)
    expect(src).not.toMatch(/ACESFilmicToneMapping/)
  })

  it('内联着色器的 varying 必须在**该段**声明（地面着色器是内联字符串，漏声明=整材质不画）', () => {
    // 地面着色器在 playbackScene 里以内联字符串给出、不在 sceneryMaterials 的工厂覆盖范围内，
    // 且顶点/片元两段各自独立声明 varying——只写不声明/只声明不写都会让整材质编译失败，
    // 页面上只表现为"地形整片不渲染"（2026-10-09 实测踩过）。故做"用到即声明"检查：
    // 片元里出现的 vXxx 标识符都必须在**片元自己的**声明段里。
    const at = src.indexOf('uniform sampler2D uCM;')
    expect(at).toBeGreaterThan(-1)
    const frag = src.slice(at, src.indexOf('`', at))
    const declPart = frag.slice(0, frag.indexOf('void main()'))
    const decls = new Set([...declPart.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]))
    expect(decls.has('vXZ')).toBe(true)              // 地面片元真实用到的 varying
    const used = new Set([...frag.matchAll(/\bv[A-Z]\w*/g)].map((m) => m[0]))
    for (const name of used) {
      expect(decls.has(name), `地面片元用到 ${name} 但未声明`).toBe(true)
    }
    // 顶点段同样声明（link 契约）
    const vat = src.indexOf('uniform vec4 uHbSoft;')   // 地面顶点段附近（类型见下方类型对齐守卫）
    expect(vat).toBeGreaterThan(-1)
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
    // 场景侧的 sRGB 只许是**显示内容**（画布贴图 / 底图 / IBL 等距柱状）：
    // 底图 mapTexture、IBL envTexture、基地标记画布、伤害飘字画布 —— 恰好 4 处。
    // 新增一处（尤其给地面分层 texs[k] 加）会改这个数 ⇒ 必须先想清楚它属于哪一类。
    const sites = [...src.matchAll(/colorSpace = THREE\.SRGBColorSpace/g)]
    expect(sites.length).toBe(4)
    expect(src).toMatch(/groundLayers = \{ layers: L, texs \};/)   // 分层纹理键集不变
    expect(src).not.toMatch(/texs\[k\][^\n]*colorSpace/);          // 分层纹理不得改采样空间
  })

  it('地面弹着痕迹（D2）已撤除：客户端贴图不在可得数据面 ⇒ 不留程序化替代', () => {
    // 客户端该效果 = FX 粒子（FX/hit_surface 的 8 发射器）+ 游戏层 geo-decal，**贴图由游戏层传入、
    // 不在可得数据面** ⇒ 没有可对齐的实现；程序化画布 + 猜测尺寸/上限属"没有客户端依据"的改动，
    // 2026-10-10 按该原则撤除（要重做需先拿到客户端贴图）。此断言防其悄悄复活。
    expect(src).not.toMatch(/impactDecals|stampGroundScar|DECALS_ON|makeScorchMaterial/)
    expect(src).not.toMatch(/get\('decals'\)/)
  })

  it('地形网格客户端同构（texel 原位取原值）——错位会让地形穿出挡土墙/桥台', () => {
    // 客户端证据：`Landscape` RO 只有 hmap+bbox（程序化）、`LandscapeSubdivision.cpp:133-136`
    // 顶点全部来自 `Heightmap::GetPoint(x,y)` = texel 原位取 texel 值（不平滑）。
    // 我们此前 `PlaneGeometry(seg)+sampleHeight(双线性)`：顶点与 texel 错位 ⇒ 陡坡处地形面
    // 向外探出 0.5–1.3 m，俯瞰下穿出挡土墙贴面（2026-10-09 用户报障）。

    // ⚠️ 断言只看代码（src 已剥注释）——用代码锚点，不要在注释文本上定位
    expect(src).toMatch(/import \{ buildAdaptiveTerrain, terrainLodStale \} from '\.\/terrainMesh\.js'/)
    expect(src).toMatch(/const geo = buildTerrainGeometry\(\);/)
    expect(src).toMatch(/function buildTerrainGeometry\(\) \{/)
    expect(src).toMatch(/field: renderField \|\| heightField, n, span,/)
    expect(src).toMatch(/maybeRebuildTerrainLod\(\);/)
    // LOD 单向滞回（拉近立即细化、拉远才允许变粗）：旧的双向 25% 滞回会让网格长期停在
    // "更远视距"的更粗层级 ⇒ 同一相机位置可比客户端判据允许的更粗 ⇒ 地形抬过贴地薄结构
    // （2026-10-10 用户"铁轨被盖、转/缩放后时有时无"）
    expect(src).toMatch(/import \{ buildAdaptiveTerrain, terrainLodStale \} from '\.\/terrainMesh\.js'/)
    expect(src).toMatch(/if \(!terrainLodStale\(terrainLodDist, d, now - terrainLodAt\)\) return;/)
    expect(src).not.toMatch(/Math\.abs\(d - terrainLodDist\) \/ Math\.max\(1, d\) < 0\.25/)
    // sampleHeight 采引擎口径（除 n，非 n−1）
    expect(src).toMatch(/const fx = \(x \/ span \+ 0\.5\) \* n, fy = \(z \/ span \+ 0\.5\) \* n;/)
    // 几何已建在场景系：不得再有 PlaneGeometry 地形 + sampleHeight 位移 + 旋转/平移放置
    expect(src).not.toMatch(/new THREE\.PlaneGeometry\(size, size, Q\.terrainSeg/)
    expect(src).not.toMatch(/setZ\(k, sampleHeight\(-pos\.getX\(k\)/)
    // 自适应网格模块与测试在位（客户端同构 LOD：顶点=texel 原值 + 视距容差细分）
    expect(src).toMatch(/aspect: camera && Number\.isFinite\(camera\.aspect\)/)
    const meshSrc = readFileSync(resolve(here, 'terrainMesh.js'), 'utf8')
    expect(meshSrc).toMatch(
      /export function buildAdaptiveTerrain\(\{ field, n, span, cam, fovY, aspect = 16 \/ 9, minStep = 1, tolScale = 1, shores = null \}\)/)
    expect(meshSrc).toMatch(/export function subdivisionMetrics\(fovYRad, aspect = 16 \/ 9, tolScale = 1\)/)
    // 引擎 `SubdivisionMetrics` 两套 fov 预设（LandscapeSubdivision.h:44-58）——阈值随 fov 插值
    expect(meshSrc).toMatch(/normalFov: 70, zoomFov: 6\.5/)
    expect(meshSrc).toMatch(
      /normalMaxHeightError: 0\.014, normalMaxPatchRadiusError: 0\.45, normalMaxAbsoluteHeightError: 3/)
    expect(meshSrc).toMatch(
      /zoomMaxHeightError: 0\.03, zoomMaxPatchRadiusError: 0\.9, zoomMaxAbsoluteHeightError: 3/)
    // 三条判据（半径/屏幕高度/绝对 3 m）都在
    expect(meshSrc).toMatch(/const subdivide = radiusError >= M\.maxPatchRadiusError/)
    expect(meshSrc).toMatch(/\|\| heightError >= M\.maxHeightError/)
    expect(meshSrc).toMatch(/\|\| err > M\.maxAbsoluteHeightError;/)
    // ⚠️ 两个误差值必须**一并返回**：子补片的 subdivMorph 要用父补片的误差（error0Delta）；
    // 曾因"半径判据命中就短路返回"导致 morph 恒 0（2026-10-10 实测报障点 morphRaw = 0）
    expect(meshSrc).not.toMatch(/return \{ subdivide: true \};/)
    // 客户端两通道高度 + morph（Landscape.cpp:CreateHeightTextureData / tilemask-vp.sl 直译）
    expect(meshSrc).toMatch(/export function morphFunc\(x\) \{/)
    expect(meshSrc).toMatch(/export function subdivMorphOf\(heightError, radiusError, heightError0, radiusError0, M\) \{/)
    expect(meshSrc).toMatch(/return avg \+ \(acc - avg\) \* m;/)
    // 终止补片内部 = 8×8 四边形（PATCH_QUADS；引擎 PATCH_SIZE_VERTICES−1）
    expect(meshSrc).toMatch(/for \(let a = 0; a < PATCH_QUADS; a\+\+\) \{/)
    // 预算用尽必须**仍出几何**（否则出现空洞 ⇒ 透出下层地面/水面）
    expect(meshSrc).toMatch(/overBudget = true;/)
    // 共面接缝不设任何人工补偿（?poff / ?seamfix 均已于 2026-10-10 撤除，理由见下一条用例）
    expect(src).not.toMatch(/scenerySeamLift|instanceSeamLift|TERRAIN_SEAM_BAND/)
    expect(src).not.toMatch(/get\('poff'\)|get\('seamfix'\)|get\('terrainlod'\)/)
    // 地形让位掩码（上游 tools/bake_terrain_cover.py）：**只夹渲染用高度场**，查询/放置走真值场
    expect(src).toMatch(/import \{ applyTerrainCover \} from '\.\/terrainCover\.js'/)
    expect(src).toMatch(/const \{ field: rf, changed \} = applyTerrainCover\(renderField, cu, k, zmin\);/)
    expect(src).toMatch(/if \(changed\) renderField = rf;/)
    expect(src).toMatch(/field: renderField \|\| heightField, n, span,/)
    // sampleHeight 必须读 heightField（真值）；若被改成 renderField，拾取/贴地/贴花会随掩码错位
    const shAt = src.indexOf('function sampleHeight')
    expect(shAt).toBeGreaterThan(-1)
    const shBody = src.slice(shAt, src.indexOf('function ', shAt + 10))   // 只到下一个函数为止
    expect(shBody).toMatch(/heightField/)
    expect(shBody).not.toMatch(/renderField/)
    // 掩码 URL（缺掩码/旧包 ⇒ fail-open 不阻断）
    const rsSrc = readFileSync(resolve(here, 'replaySource.js'), 'utf8')
    expect(rsSrc).toMatch(/case 'cover': return f\('cover\.u16\.bin'\)/)
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
    // ⑥ 接线：先于光照图与受光兜底；要求 extras.decal + 几何 UV1 + 地表分层贴图在位
    const wire = src.indexOf('if (ud.decal && groundLayers && o.geometry.attributes.uv1)')
    expect(wire).toBeGreaterThan(-1)
    expect(src.slice(wire, wire + 800)).toMatch(/makeDecalMaterial\(m, cmTex, groundLayers\.texs\.lm, \{/)
    expect(src.slice(wire, wire + 800)).toMatch(/separateLm: !!GL\.separate_lm,/)
    expect(wire).toBeLessThan(src.indexOf('if (ud.lightmap !== undefined'))
    expect(src).toMatch(/makeDecalMaterial,/)
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

  it('退化几何守卫 + ?degrade=N 覆盖（撕裂批次不渲染/不占 draw call）', () => {
    expect(src).toMatch(/const degradedMeshes = \[\];/)
    expect(src).toMatch(/const q = Number\(new URLSearchParams\(location\.search\)\.get\('degrade'\)\);/)
    expect(src).toMatch(/if \(vc > 0 && \(ic \/ 3\) \/ vc > degLimit\) degradedMeshes\.push\(o\);/)
    expect(src).toMatch(/o\.removeFromParent\(\);/)
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
    // 接线：extras.blendByAngle → 专用材质；extras.alphaBlend 不得被"伪透明→裁切"启发式削掉
    expect(src).toMatch(/if \(ud\.blendByAngle\) \{/);
    expect(src).toMatch(/return makeBlendByAngleMaterial\(m, ud\.blendByAngle\);/);
    expect(src).toMatch(/const softAlpha = !!\(m\.userData && m\.userData\.alphaBlend\);/);
    expect(src).toMatch(/>= 0\.99 && !blendLayer && !softAlpha;/);
    expect(src).toMatch(/\(m\.userData && m\.userData\.alphaBlend\) \|\| '',/);
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
    expect(src).toMatch(/coast: waterCoast \}\);/)
    expect(src).toMatch(/if \(waterTexDispose\) \{ waterTexDispose\.dispose\(\); waterTexDispose = null; \}/)
    expect(src).toMatch(/waterCoast = \{/)
    expect(src).toMatch(/function terrainSpanOf\(\) \{/)
    expect(src).not.toMatch(/terrainCellBound\(1, camera/)          // 旧"单元格上界"口径：禁止复活
    const wSrc = readFileSync(resolve(here, 'sceneryMaterials.js'), 'utf8')
    expect(wSrc).toMatch(/export function makeWaterMaterial\(m, \{ normalTex, cubeTex, props, coast = null \}\)/)
    expect(wSrc).toMatch(/uniform sampler2D uHeightmap;/)
    // 阈值量纲 = **本渲染器的深度分辨率**（2 ulp）：岸线带（差值小到缓冲分不开）淡出、
    // 深水任何角度满反射（含俯视）。旧的"相机高 − 水面高"分母已废（俯视时深水被压没）。
    expect(wSrc).toMatch(/float dNdcZ = \(2\.0 \* uFar \* uNear \/ \(\(uFar - uNear\) \* zlen \* zlen\)\) \* dzAlong;/)
    expect(wSrc).toMatch(/coastLine = clamp\(dNdcZ \/ \(2\.0 \* uDepthUlp\), 0\.0, 1\.0\);/)
    expect(wSrc).toMatch(/float dzAlong = \(vWorldP\.y - terrainY\) \/ max\(abs\(toCam\.y\) \/ zlen, 1e-3\);/)
    expect(wSrc).toMatch(/float terrainY = texture2D\(uHeightmap, vWorldP\.xz \/ uMapSpan \+ 0\.5\)\.r;/)
    expect(wSrc).toMatch(/gl_FragColor = vec4\(refl, clamp\(fresnel, 0\.0, 1\.0\) \* coastLine\);/)
    expect(wSrc).not.toMatch(/uCoastCellPerDist|cellPerDist/)
    expect(wSrc).not.toMatch(/max\(cameraPosition\.y - vWorldP\.y, 1e-3\)/)     // 旧"相机高"口径：禁止复活
    expect(src).toMatch(/depthUlp: 2 \/ Math\.pow\(2, depthBits\),/)
    expect(src).toMatch(/glc\.getParameter\(glc\.DEPTH_BITS\)/)
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
    expect(src).toMatch(/gltf\.scene\.updateMatrixWorld\(true\);\s*\n\s*const waterSurfaces = \[\];/)
    expect(src).toMatch(/const underWater = \(o\) => \{/)
    expect(src).toMatch(/bb\.max\.z <= w\.h \+ 0\.05\) return true;/)
    expect(src).toMatch(/const uw = !!o\.geometry && underWater\(o\);/)
    expect(src).toMatch(/if \(ud\.lightmap !== undefined && !isWaterNode\(o\.name, m\) && !\/sky\/i\.test\(o\.name \|\| ''\)\s*\n\s*&& !underWater\(o\)\) \{/)
    expect(src).toMatch(/if \(uw\) \{/)
    expect(src).toMatch(/new THREE\.MeshBasicMaterial\(\{/)
    expect(src).toMatch(/map: m\.map \|\| null,/)
    // 水上面向不走这条：判据只在"整个包围盒低于水面片标高"成立，且水/天空已排除
    expect(src).not.toMatch(/underWater\(o\) \|\| true/)
  })

  it('岸线特征接线：水面/水下薄板标高表 → 地形网格第四条判据，装载后立即重建一次', () => {
    // 用户实测判据（2026-10-10）："拉近之后锯齿变细、旋转时形状固定" ⇒ 网格量化而非深度抢闪。
    // 修法见 terrainMesh.js `shores`：补片与水面占地相交且格点高度跨其标高 ⇒ 细到 1 texel。
    // 真图实测（malinovka，300 m 相机）：无判据时渲染岸线 51 行/22 行来回摆动，有判据时
    // 45 行/7 行 —— 与原始场（客户端最细口径）**完全一致**；三角形 17k → 70k。
    expect(src).toMatch(/const sh = \[\];/)
    expect(src).toMatch(/sh\.push\(\{ y: w\.h, x0: -w\.x1, x1: -w\.x0, z0: w\.y0, z1: w\.y1 \}\);/)
    expect(src).toMatch(/shoreLevels = sh\.length \? sh : null;/)
    expect(src).toMatch(/shoreLevels = null;\s*\n/)                              // 会话 teardown 清理
    expect(src).toMatch(/if \(shoreLevels && terrainMesh && heightField\) \{/)
    expect(src).toMatch(/terrainMesh\.geometry = buildTerrainGeometry\(\);/)
    expect(src).toMatch(/shores: shoreLevels,/)
    expect(src).toMatch(/let shoreLevels = null;/)
  })

  it('地面分层混合 uniform 类型对齐：uHbSoft 必须 vec4（曾误写 float ⇒ 值 NaN ⇒ 地面取错层色）', () => {
    // 2026-10-10 用户"米德尔堡地面贴图颜色还是不对"（= erlenberg，display='Middleburg'）。
    // 实况：`groundShaderMaterial` 的片元里 `uHbSoft` 被写成 `uniform float`，而 JS 侧下发
    // `new THREE.Vector4(L.hb_softness…)` ⇒ three 按**声明类型**上传（uniform1f 收到对象 ⇒ NaN）
    // ⇒ 开 HEIGHT_BLEND 的 9 图（desert_train/erlenberg/holland/idle/lagoon/plant/pliego/rift/rudniki）
    // 高度分层混合权重全废、地面取错层色。着色器门禁只编译（`vec4 − float` 是合法标量广播）⇒ 抓不到，
    // 故此处用类型对齐守卫看护：声明类型必须与 JS 下发值一致。
    expect(src).toMatch(/uniform vec4 uHbSoft;/)
    expect(src).not.toMatch(/uniform float uHbSoft;/)
    expect(src).toMatch(/uHbSoft: \{ value: new THREE\.Vector4\(L\.hb_softness\[0\], L\.hb_softness\[1\],/)
    expect(src).toMatch(/uniform vec4 uHbScale;/)
    expect(src).toMatch(/uniform vec4 uHbOffset;/)
  })

  it('逐图光照亮度归一：保留方向/色相，曝光 = 基准太阳强度 / 该图太阳强度（模拟客户端自动曝光）', () => {
    // 2026-10-10 用户"米德尔堡地面颜色还是不对"：线上部署版**不消费 lighting.json**（0 处引用），
    // 用固定兜底灯（白 3.0 + 半球 2.4）；我们按计划书"期 1"搬了逐图太阳（36 图 intensity 3–14、
    // 色相各异）却还没做"期 2"的曝光标定 ⇒ 走 three 内建管线的材质（受光场景件 = 河床/铺装等
    // Lambert 件、坦克）被照成 2–5× 基准 ⇒ 线性输出削顶、发白偏橙。用户裁示"保色相、归亮度"：
    // 保留 sun.direction/color（逐图氛围），曝光按该图太阳强度归一到 DEFAULT_SUN_INTENSITY 那一档
    // ——同一图内 太阳:环境:IBL 的相对关系不变，仅把绝对亮度钉回基准（≈ 固定曝光模拟自动曝光）。
    expect(src).toMatch(/renderer\.toneMapping = THREE\.LinearToneMapping;/)
    expect(src).toMatch(/const expo = THREE\.MathUtils\.clamp\(DEFAULT_SUN_INTENSITY \/ sun\.intensity, 0\.05, 4\.0\);/)
    expect(src).toMatch(/renderer\.toneMappingExposure = expo;/)
    expect(src).toMatch(/if \(renderer\) renderer\.toneMappingExposure = 1\.0;/)
    expect(src).toMatch(/sunLight\.color\.setRGB\(sun\.color\[0\], sun\.color\[1\], sun\.color\[2\]\);/)
    expect(src).toMatch(/sunLight\.position\.set\(-d\[0\] \/ n, -d\[1\] \/ n, -d\[2\] \/ n\)\.multiplyScalar\(1000\);/)
  })

  it('水体：透明面写深度 + 双面 + 不设 renderOrder', () => {
    expect(matSrc).toMatch(/const isWaterName = \(n\) => \/water\|sea\|lake\|river\|fountain\/i\.test\(n \|\| ''\);/)
    // 水面判定改为**材质级标记**驱动（新包 asset.extras.surfaceFlags ⇒ 读材质 extras.water；
    // 旧包退回名字启发式）——名字启发式曾把水塔 `bld_er_water_tower_pbr` 误判成水面，
    // 使该建筑退回受光材质整体发白（2026-10-09 用户报障）。
    expect(src).toMatch(/const strictSurfaces = !!\(gltf\.scene\.userData && gltf\.scene\.userData\.surfaceFlags\);/)
    expect(src).toMatch(/return !!\(m0 && m0\.userData && m0\.userData\.water\);/)
    expect(src).toMatch(/!\/sky\/i\.test\(e\.name\) && !isWaterNode\(e\.name, e\.material\)\);/)
    // MEDIUM 档水面是半透明大面：逐材质修整（depthWrite/DoubleSide/depthTest）必须保留——
    // 2026-10-09 随 LOW 档（不透明）删过一次，回退 MEDIUM 时一并恢复
    const water = src.slice(src.indexOf('if (isWaterNode(o.name, o.material))'))
    expect(water.slice(0, 900)).toMatch(/mm\.depthWrite = true;/)
    expect(water.slice(0, 900)).toMatch(/mm\.side = THREE\.DoubleSide;/)
    expect(water).not.toMatch(/mm\.renderOrder =/)
  })

  it('对数深度缓冲：默认开启 + ?logdepth=0 逃生开关 + 两自定义 ShaderMaterial 挂 logdepthbuf 块', () => {
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
    expect(src).toMatch(/logarithmicDepthBuffer: LOGDEPTH/)
    // logdepthbuf_vertex 调用 isPerspectiveMatrix（定义在 <common>）：自定义 vertex
    // shader 必须 include <common>，否则 GLSL 编译失败、材质整片不渲染
    const billboard = matSrc.slice(matSrc.indexOf('function makeBillboardMaterial'))
    expect(billboard).toMatch(/#include <common>/)
    expect(billboard).toMatch(/#include <logdepthbuf_pars_vertex>/)
    expect(billboard).toMatch(/#include <logdepthbuf_vertex>/)
    expect(billboard).toMatch(/#include <logdepthbuf_pars_fragment>/)
    expect(billboard).toMatch(/#include <logdepthbuf_fragment>/)
    const ground = src.slice(src.indexOf('function groundShaderMaterial'), src.indexOf('function rebuildGround'))
    expect(ground).toMatch(/#include <common>/)
    expect(ground).toMatch(/#include <logdepthbuf_pars_vertex>/)
    expect(ground).toMatch(/#include <logdepthbuf_vertex>/)
    expect(ground).toMatch(/#include <logdepthbuf_pars_fragment>/)
    expect(ground).toMatch(/#include <logdepthbuf_fragment>/)
  })

  it('场景 Lambert 曝光修整只作用于 convMat 建出的材质', () => {
    expect(matSrc).toMatch(/const SCENERY_LAMBERT_EXPOSURE = 0\.75/)
    expect(src).toMatch(/\.multiplyScalar\(SCENERY_LAMBERT_EXPOSURE\)/)
  })

  it('天空穹：unlit + 无限远方向投影 + 不写深度/不参与雾（此前整节点隐藏）', () => {
    // 回归：`o.visible = false` 把天穹整节点藏掉 → 背景只剩纯色 0x11161d（抬头没有天）。
    // 客户端 skyobject-materials-vp.sl：`mul(float4(position.xyz, 0.0), worldViewProjMatrix)`
    // —— w=0 丢弃平移，网格坐标本身就是方向（实测多数图天穹网格半径仅 ~10m，当普通几何
    // 渲染就是地图中心一个小球），深度靠 w 偏置推到最后，着色器无任何光照项。
    expect(src).not.toMatch(/o\.visible = false/);
    const skyAt = src.indexOf('/sky/i.test(o.name');
    expect(skyAt).toBeGreaterThan(-1);
    const skyBranch = src.slice(skyAt, skyAt + 500);
    expect(skyBranch).toMatch(/makeSkyMaterial\(o\.material\)/);
    expect(skyBranch).toMatch(/o\.frustumCulled = false;/);
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
    expect(src).toMatch(/const aniso = Math\.min\(Q\.anisotropy, renderer\.capabilities\.getMaxAnisotropy\(\)\);/);
    expect(src).toMatch(/applyMaterialTextureAnisotropy\(gltf\.scene, aniso\)/);
    expect(matSrc).toMatch(/export function applyMaterialTextureAnisotropy\(root, anisotropy\)/);
    const fn = matSrc.slice(matSrc.indexOf('export function applyMaterialTextureAnisotropy'));
    expect(fn).toMatch(/t\.anisotropy = anisotropy;/);
    expect(fn).toMatch(/t\.needsUpdate = true;/);
    // ShaderMaterial 的贴图挂在 uniforms 上（叶卡/ST|/天穹），只枚举直接属性会漏
    expect(fn).toMatch(/m\.uniforms/);
    expect(fn).toMatch(/seen\.has\(t\.uuid\)/);   // 同贴图跨材质共享：只设一次
  });

  it('场景材质用几何 authored 法线（不设 flatShading——旧行为把它整条丢掉）', () => {
    // 导出器 v0.4.1 起随导 authored 法线（fail-closed：条数对齐 + 中位模长 1±10%），
    // 前端 flatShading=true 会让渲染器改由屏幕导数现算面法线 → 导出侧工作全部作废、
    // 硬边与烘焙法线被抹平。内核与俯视烘焙页（同一 SSOT 约定）都不得再设。
    expect(src).not.toMatch(/flatShading/);
    // 烘焙页同口径读法：先剥注释（注释里会提到反例写法，不得算作代码）
    const bakeSrcNormals = readFileSync(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'), 'utf8')
      .replace(/\/\/[^\n]*/g, '');
    expect(bakeSrcNormals).not.toMatch(/flatShading/);
  });

  it('俯视烘焙页消费同一材质模块，且 convMat 键组成与内核逐字一致', () => {
    // bake-ground-overhead 的俯视烘焙以 3D 档观感为基准——材质实现与键指纹
    // 若与内核漂移，同一材质在两侧会拆成不同实例/不同观感
    const bakeSrc = readFileSync(resolve(here, '..', '..', 'scripts', 'bake-ground-overhead.mjs'), 'utf8')
      .replace(/\/\/[^\n]*/g, '')
    expect(bakeSrc).toMatch(/from '\/src\/scene\/sceneryMaterials\.js'/)
    expect(bakeSrc).toMatch(/const convMat = \(m, isCard\) => cachedSceneryMat\(/)
    const bakeKey = bakeSrc.slice(bakeSrc.indexOf('const convMat = (m, isCard) => cachedSceneryMat('))
    const kernelKey = src.slice(src.indexOf('const convMat = (m, isCard) => cachedSceneryMat('))
    // 缩进在两处上下文里天然不同（内核闭包 vs 烘焙 load），先折叠空白再比对前缀
    const fingerprint = (t) => t.replace(/\s+/g, '').slice(0, 500)
    expect(fingerprint(bakeKey)).toBe(fingerprint(kernelKey))
  })

})

describe('__hullGroup 挂点（车体 = 记录位姿；逐轮悬挂待实现）', () => {
  it('底盘（chassis_track_*/chassis_wheel_*）与车体子树分离，挂点恒归单位；命名不符则回落整台刚体', () => {
    // 2026-10-10 回退：「根吃地形局部平面 + 车体收限幅残差」的近似已撤——车体恢复客户端同构的
    // **记录位姿**摆放（poseGlb 直摆记录 yaw/pitch/roll）；__hullGroup 仅作后续悬挂实现的挂点。
    expect(src).toMatch(/\^chassis_\(track\|wheel\)_\/i\.test\(child\.name \|\| ''\)/)
    expect(src).toMatch(/hullGroup = new THREE\.Group\(\);/)
    expect(src).toMatch(/hullGroup\.name = '__hullGroup';/)
    expect(src).toMatch(/return \{ turretNode, gunNodes, tP, gP, hullGroup,/)
    // 两条位姿路径（GLB / 低模）都对 hullGroup 归单位：拆分组不得改变摆放
    expect(src).toMatch(/p\.hullGroup\.quaternion\.identity\(\);/)
    expect(src).toMatch(/p\.hullGroup\.position\.set\(0, 0, 0\);/)
    expect(src).toMatch(/v\.hullGroup\.quaternion\.identity\(\);/)
    // 旧近似整段移除：内核不得再出现地形局部平面/限幅残差解算（准备件留在 glbRig.js，未接线）
    expect(src).not.toMatch(/terrainPitchRoll/)
    expect(src).not.toMatch(/clampHullAttitude/)
    expect(src).not.toMatch(/poseLocalBetween/)
    // 低模侧挂点：履带盒留组根、hull/grille/turretG 收进同名 hullGroup
    expect(src).toMatch(/const hullG = new THREE\.Group\(\); hullG\.name = '__hullGroup';/)
    expect(src).toMatch(/hullGroup: hullG \};/)
  })
})

describe('悬挂接线（轮/带逐帧解算，客户端同构）', () => {
  it('数据来自包内 suspension/<id>.json（取证失败回落刚体），求解器独立成模块', () => {
    // 数据面无该车（或 404）→ 整车刚体：与"客户端无悬挂数据"同路，不造缺省值
    expect(src).toMatch(/from '\.\/suspension\.js'/)
    expect(src).toMatch(/assetProvider\.json\(`\/suspension\/\$\{tankId\}\.json`\)\.catch\(\(\) => null\)/)
    expect(src).toMatch(/v\.suspParts = collectSuspensionParts\(inst, loaded\.susp, v\.def\.tank_id\)/)
    expect(src).toMatch(/v\.def\.suspReaction = loaded\.susp \? loaded\.susp\.wheels_reaction_speed : null/)
  })

  it('每帧在 poseGlb 里解算；seek 跳变吸附；不可见时侧位移积分复位', () => {
    const glb = src.slice(src.indexOf('function poseGlb'), src.indexOf('async function applyGlbToggle'))
    expect(glb).toMatch(/suspensionStep\(v\);/)
    // 跳变（seek）语义 = 客户端"首次可见直接吸附"：行程吸附、侧位移不积分
    expect(src).toMatch(/suspSnap = true;[\s\S]{0,160}tick\(\);/)
    expect(src).toMatch(/for \(const v of V\) applyPose\(v\);[\s\S]{0,60}suspSnap = false;/)
    expect(src).toMatch(/if \(v\.suspParts\) \{[\s\S]{0,200}\.prev = null;/)
    // 逐帧 dt 来自主循环（按帧步长限速 = 客户端 wheelsReactionSpeed·dt 同口径）
    expect(src).toMatch(/suspDt = dt;[\s\S]{0,80}tick\(\);/)
  })

  it('关闭 GLB / 会话结束：状态不残留，逐车 clone 的履带几何显式释放', () => {
    expect(src).toMatch(/v\.glbParts = null; v\.suspParts = null;/)
    expect(src).toMatch(/for \(const g of v\.suspParts\.disposables\) g\.dispose\(\);/)
  })

  it('只动底盘节点（chassis_wheel_* / chassis_track_*）：轮数/链数不符即 fail-closed', () => {
    // 名字解析走 suspension.js 的纯函数（语义由 suspension.test.js 锁：两位编号、多段履带）
    expect(src.includes('parseWheelNodeName(n.name)')).toBe(true)
    expect(src.includes('parseTrackNodeName(n.name)')).toBe(true)
    // 客户端口径 `wheelInfos.size() == suspension.wheels.size()`：轮数不符整台回落刚体
    expect(src).toMatch(/wheelNodes\.length !== susp\.wheels\.length\) return null;/)
    expect(src).toMatch(/trackNodes\.length !== chains\.length\) return null;/)
    // 履带几何逐车 clone（模板几何共享：变形会互相串）
    expect(src).toMatch(/mesh\.geometry = mesh\.geometry\.clone\(\);/)
    // 轮自转必须走 pivot 补偿：导出器把轮几何烘进顶点、节点留在原点 —— 直接写旋转 =
    // 轮绕整车公转（实测轮心漂 5.4~6.8 m，观感"旋转混乱"）
    expect(src).toMatch(/applyWheelSpin\(w\.node, w\.restPos, w\.restQuat, w\.pivot, w\.restPivotRot,/)
    expect(src).toMatch(/node\.parent\.worldToLocal\(ctr\.clone\(\)\)/)
  })

  it('花纹写 V 只取模**偏移**（逐顶点取模会拉长跨 wrap 图元 = "外表面一小段没有纹理"）', () => {
    // 回归：旧写法 `val = frac(uvBase + offset)` 把 KRV 底段（跨 2.85 wrap）折成 0.15 wrap
    // ⇒ 纹理被拉长 ~18×；现改为整带同相（取模只作用于 offset）
    expect(src).toMatch(/writeUvOffsetV\(gp\.uvAttr\.array, gp\.uvBase, uv\);/)
    const scroll = src.slice(src.indexOf('writeUvOffsetV(gp.uvAttr.array'),
                             src.indexOf('writeUvOffsetV(gp.uvAttr.array') + 400)
    expect(scroll).not.toMatch(/Math\.floor\(val\)/)
    expect(src).not.toMatch(/val -= Math\.floor\(val\)/)
  })

  it('花纹滚动速率来自**网格实测** dV/ds，不是客户端形式常数 textureScale/chunkLength', () => {
    // 实测（30 辆抽样）客户端形式常数比网格真实斜率大 3.4~19×（中位 4.5×）——直接用会明显偏快
    expect(src).toMatch(/const uvFit = measureBeltUvSlope\(uvSamples\);/)
    expect(src).toMatch(/const dvPerM = uvFit\.ok \? chainBottomRunDir\(chain2\) \* uvFit\.slope : 0;/)
    expect(src).toMatch(/tg\.uv = treadScrollStep\(tg\.uv, dS, tg\.dvPerM\)/)
    // 逐帧路径不得再引用客户端形式常数（量纲不同，见 suspension.js 注释）
    const step = src.slice(src.indexOf('function suspensionStep'), src.indexOf('async function applyGlbToggle'))
    expect(step).not.toMatch(/textureScale/)
  })
})

describe('播放时钟与速度档位（对齐上游的纯函数入口）', () => {
  it('推进走 advancePlaybackTime（NaN/负增量不污染时钟），终点钳制仍生效', () => {
    expect(src).toMatch(/T = advancePlaybackTime\(T, END, dt \* 1000, SPEED\);/)
    expect(src).not.toMatch(/T \+= dt \* SPEED;/)
  })

  it('setSpeed 只接受档位表内的值', () => {
    expect(src).toMatch(/function setSpeed\(s\) \{ if \(!isPlaybackSpeed\(s\)\) return;/)
  })

  it('onResize 单画布取整尺寸 + 置脏重绘（防 1px 错位与脏帧停住）', () => {
    const resize = src.slice(src.indexOf('function onResize'), src.indexOf('function onScenePointerDown'))
    expect(resize).toMatch(/const w = Math\.max\(1, Math\.round\(container\.clientWidth\)\);/)
    expect(resize).toMatch(/renderer\.setSize\(w, h\);/)
    expect(resize).toMatch(/invalidate\(\);/)
    expect(resize).not.toMatch(/labelRenderer/)
  })

  it('覆盖层并入主画布：不再有第二个 WebGL 上下文', () => {
    // 回归：独立标签画布 = 两块 GPU 表面 + 浏览器逐帧两画布合成
    expect(src).not.toMatch(/labelRenderer/)
    const ctor = src.match(/new THREE\.WebGLRenderer\(/g) || []
    expect(ctor.length).toBe(1)
    const animate = src.slice(src.indexOf('function animate()'))
    expect(animate).toMatch(/renderer\.autoClear = false;/)
    expect(animate).toMatch(/renderer\.render\(labelScene, camera\);/)
    expect(animate).toMatch(/renderer\.autoClear = true;/)
  })

  it('特效走对象池：到期归池而非 dispose，池只在会话结束时整体释放', () => {
    // 回归：每发/每次命中/每次击毁新建 geometry+material 再 dispose → 交火高峰分配尖峰
    expect(src).toMatch(/function fxTake\(key, make\)/)
    expect(src).toMatch(/function disposeFxPool\(\)/)
    for (const key of ['tracer', 'traj', 'burst', 'floatDmg']) {
      expect(src.includes(`fxGive('${key}'`)).toBe(true)
    }
    expect(src).toMatch(/fxGive\('impact-' \+ im\.kind/)
    // 热路径不得再出现逐次 dispose（geometry/material 的释放只在 disposeFxPool 内）
    const hot = src.slice(src.indexOf('function spawnShot'), src.indexOf('function updateBases'))
    expect(hot).not.toMatch(/\.geometry\.dispose\(\)/)
    expect(hot).not.toMatch(/\.material\.dispose\(\)/)
    expect(src).toMatch(/disposeFxPool\(\);/)
  })

  /**
   * 装填条求值门控：3D 标签改为 HTML 覆盖层后，求值从"每车 sprite 重绘"变成
   * `publishLabels` 的节流快照。两条不变量不变：
   *   1. 关标签时整段不做（`store.labelsOn` 早退）；
   *   2. 暂停 / T 未变时不重复求值（时间戳门控）。
   */
  it('装填条求值：关标签或 T 未变时跳过（暂停/关标签不再每车每帧全量求值）', () => {
    const publish = src.slice(src.indexOf('function publishLabels'), src.indexOf('function setLabelPrefs'))
    expect(publish, '关标签时必须整段早退').toMatch(/if \(!DATA \|\| !labelOverlay \|\| !store\.labelsOn\) return;/)
    // 动态节流（2026-10-05）：装填中 33ms（~30Hz，进度平滑）/ 空闲 100ms。
    expect(publish, 'T 未变 / 未到节流窗口时不得重复求值')
      .toMatch(/if \(!force && \(T === labelsTime \|\| now - labelsWrittenMs < interval\)\) return;/)
    expect(publish, '装填中提高发布频率').toMatch(/labelsReloadActive \? LABEL_INTERVAL_RELOAD_MS : LABEL_INTERVAL_IDLE_MS/)
    expect(src, '装填中 33ms').toMatch(/const LABEL_INTERVAL_RELOAD_MS = 33;/)
    expect(src, '空闲 100ms（原值）').toMatch(/const LABEL_INTERVAL_IDLE_MS = 100;/)
    // 求值本身只依赖 T（纯状态在时刻）：走共享 resolver，不再自带累加计时器；
    // 弹容 N 由 resolver 从 facet 车辆的 burst_size 取默认（调用点不再传 v.reloadSize）
    expect(publish).toMatch(/reload: destroyed \? null : reloadStateAt\(v\.def\.eid, T\)/)
  })

  it('HUD 降频：store.time/seekFrac 不再每帧写，seek 时强制补一次', () => {
    expect(src).toMatch(/const HUD_INTERVAL_MS = 100;/)
    expect(src).toMatch(/function writeHud\(force = false\)/)
    expect(src).toMatch(/writeHud\(true\);/)
    const tick = src.slice(src.indexOf('function tick()'), src.indexOf('function writeHud'))
    expect(tick).not.toMatch(/store\.time = T;/)
  })

  it('比分/点数走增量而非每 tick 全量扫描', () => {
    expect(src).toMatch(/let scorePtr = 0, score1 = 0, score2 = 0;/)
    expect(src).toMatch(/function resetScore\(\)/)
    expect(src).toMatch(/while \(scorePtr < DATA\.kills\.length && DATA\.kills\[scorePtr\]\.t <= T\)/)
    expect(src).toMatch(/if \(DATA\.kills\) DATA\.kills\.sort\(\(a, b\) => a\.t - b\.t\);/)
  })

  it('资产加载走有限并发（地表贴图 / 坦克 GLB 都受上限约束）', () => {
    expect(src).toMatch(/const ASSET_CONCURRENCY = 4/)
    expect(src).toMatch(/await mapLimit\(need, ASSET_CONCURRENCY/)
    expect(src).toMatch(/await mapLimit\(V\.filter\(v => v\.def\.tank_id > 0\), ASSET_CONCURRENCY/)
  })

  it('GLB 位姿零分配：poseFromYPR 支持 out 参数，poseGlb 用模块级 scratch', () => {
    // 回退后（记录位姿）：根 = 记录 yaw/pitch/roll 一次合成，无高度场参与
    expect(src).toMatch(/v\.glb\.quaternion\.copy\(poseFromYPR\(-yawAt\(v, T\), hullPitchAt\(v, T\), -rollAt\(v, T\), _glbQuat\)\);/)
    expect(src).toMatch(/v\.glb\.position\.copy\(v\.group\.position\);/)
    const glb = src.slice(src.indexOf('function poseGlb'), src.indexOf('async function applyGlbToggle'))
    expect(glb).not.toMatch(/terrainPitchRoll|clampHullAttitude|sampleHeight/)
    expect(glb).not.toMatch(/new THREE\.Matrix4\(\)/)     // 每帧不再新建矩阵
    expect(glb).not.toMatch(/new THREE\.Euler\(\)/)
    expect(glb).toMatch(/_mAcc\.copy\(mT\)\.multiply\(tn\.userData\.__bake\)/)
    // bake 捕获的 clone 是一次性（userData.__bake），不属于逐帧分配
  })

  it('按需渲染：脏帧判定覆盖播放/相机/特效/幽灵闪，跳帧时不跑更新与 render', () => {
    const animate = src.slice(src.indexOf('function animate()'))
    expect(animate).toMatch(/const busy = PLAYING/)
    expect(animate).toMatch(/\|\| cameraMoved/)
    expect(animate).toMatch(/\|\| frameDirty/)
    expect(animate).toMatch(/tracers\.length > 0 \|\| impacts\.length > 0 \|\| floatDmgs\.length > 0 \|\| burstFx\.length > 0/)
    expect(animate).toMatch(/ghostByEid\.size > 0 \|\| flashByEid\.size > 0;/)
    expect(animate).toMatch(/if \(!busy\) return;/)
  })
})

describe('车体横滚（hull_roll）接线守卫', () => {
  it('侧倾取值助手：旧产物缺列时落 0（不拿 pitch 顶替）', () => {
    expect(src).toMatch(/const rollAt = \(v, t\) => \(v\.def\.hull_roll && v\.def\.hull_roll\.length \? arrAt\(v\.def\.hull_roll, t\) : 0\);/)
  })

  it('两条位姿路径都带 roll，且符号为负（镜像约定：绕前向轴取负，与 -yaw 同理）', () => {
    // GLB 路径：记录 roll 取负进 poseFromYPR（客户端同构，见 glbRig.js 符号约定）
    expect(src).toMatch(/poseFromYPR\(-yawAt\(v, T\), hullPitchAt\(v, T\), -rollAt\(v, T\), _glbQuat\)/)
    // 低模路径：同一口径的记录位姿（y=-yaw / x=pitch / z=-roll）
    expect(src).toMatch(/v\.group\.rotation\.y = -yawAt\(v, T\);/)
    expect(src).toMatch(/v\.group\.rotation\.x = hullPitchAt\(v, T\);/)
    expect(src).toMatch(/v\.group\.rotation\.z = -rollAt\(v, T\);/)
  })

  it('横滚与偏航符号同号、俯仰不受影响（镜像约定的可判据部分）', () => {
    // 注释里的完整推导不入断言（src 已剥注释）；这里只锁「yaw 取负 ⇒ roll 也取负」这一约定
    expect(src).toMatch(/-yawAt\(v, T\)/)
    expect(src).toMatch(/-rollAt\(v, T\)/)
    expect(src).not.toMatch(/\+rollAt\(v, T\)/)
  })
})

describe('炮线渲染守卫（阵营语义色直出）', () => {
  it('炮线与全弹道轨迹线都跳过出屏曲线与曝光（toneMapped: false）', () => {
    // 出屏曲线 / 曝光乘子（three 的 tone mapping 与 exposure）会改字面色——
    // UI 语义色必须直出，否则深色阵营色被二次压暗（2026-10-05 实测"亮度限制"根因）。
    // 注释在 src 里已被剥离：按材质实参断言（两处：飞行段 + 全弹道轨迹线）
    expect(src).toMatch(/new THREE\.MeshBasicMaterial\(\{ color, toneMapped: false \}\)/)
    expect(src).toMatch(/opacity: TRAJ_OPACITY, depthWrite: false,\s*toneMapped: false,/)
  })

  it('轨迹线透明度低于 0.5 会发灰：基准必须 ≥ 0.5（当前 0.6）', () => {
    const m = src.match(/const TRAJ_OPACITY = ([0-9.]+);/)
    expect(m).toBeTruthy()
    expect(Number(m[1])).toBeGreaterThanOrEqual(0.5)
  })

  it('飞行段时长 = 真实飞行时长（不得再有"最小显示时长"拖慢炮弹）', async () => {
    const { tracerSpanSecs } = await import('./playbackScene.js')
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
    // 源码护栏：飞行时长必须由纯函数/折线段时长给出，且不存在 0.22 之类的最小显示钳位
    // （折线弹道：`legEnds` 由 `legSecsOf(s, tracerSpanSecs(...))` 累计 → t1 = 末段结束时刻）
    expect(src).toMatch(/const legSecs = legSecsOf\(s, tracerSpanSecs\(s\.flight_secs\)\);/)
    expect(src).toMatch(/const t1 = legEnds\[legEnds\.length - 1\];/)
    expect(src).not.toMatch(/Math\.max\(0\.22, s\.flight_secs\)/)
  })

  it('着色器预热：场景就绪时 compile 一次（首次开火才编译＝开局/接火卡顿）', () => {
    expect(src).toMatch(/function prewarmShaders\(\)/)
    expect(src).toMatch(/renderer\.compile\(scene, camera\);/)
    expect(src).toMatch(/renderer\.compile\(labelScene, camera\);/)
    // 会话启动路径必须调用（GLB 恢复之后、开播之前）
    expect(src).toMatch(/if \(glbOn\) applyGlbToggle\(true\);[\s\S]{0,60}prewarmShaders\(\);/)
  })

  it('性能探针带主线程停顿看门狗（抓帧循环之外的长任务）', () => {
    expect(src).toMatch(/setInterval\(\(\) => \{/)
    expect(src).toMatch(/PERF_HEARTBEAT_MS = 50/)
    expect(src).toMatch(/main-thread stalls/)
  })

  it('性能探针：`?perf` 才挂载、只读记录（不改渲染行为）', () => {
    expect(src).toMatch(/new URLSearchParams\(window\.location\.search\)\.has\('perf'\)/)
    expect(src).toMatch(/window\.__pbPerf = \{/)
    // 分阶段计时包住「状态更新」与「提交渲染」两段
    expect(src).toMatch(/const perfT1 = PERF \? performance\.now\(\) : 0;/)
    expect(src).toMatch(/if \(PERF\) perfFrame\(perfT1 - perfT0, performance\.now\(\) - perfT1\);/)
  })

  it('炮线粗细：飞行段 ≥ 轨迹线（层级不变），且都不低于加粗后的下限', () => {
    const tr = Number(src.match(/const TRACER_RADIUS = ([0-9.]+);/)?.[1])
    const tj = Number(src.match(/const TRAJ_RADIUS = ([0-9.]+);/)?.[1])
    expect(tr).toBeGreaterThanOrEqual(0.36)
    expect(tj).toBeGreaterThanOrEqual(0.18)
    expect(tr).toBeGreaterThan(tj)
  })
})

describe('disposeSceneGroup —— 双图资源生命周期（评审 P2）', () => {
  // 烘焙页 --all 在同一 renderer 里逐图运行：共享 SpeedTree shader 的贴图在
  // uniforms.map.value，只枚举直接属性会漏（material dispose=1、texture dispose=0，
  // 显存随图数累积）；模块级材质缓存不清理则下一图拿到已 dispose 的失效实例。
  it('释放 uniforms 纹理与材质，并清空材质缓存使下一图拿到新实例', async () => {
    const { vi } = await import('vitest')
    const { makeBillboardMaterial, disposeSceneGroup, clearSceneryMatCache } = await import('./sceneryMaterials.js')
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
