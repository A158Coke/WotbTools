import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { PLAYBACK_SCENE_SOURCE } from './playbackScene.test.source.js'
const here = dirname(fileURLToPath(import.meta.url))
const readSrc = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const src = PLAYBACK_SCENE_SOURCE.replace(/\r\n/g, '\n')
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
const lblSrc = stripComments(readSrc(resolve(here, 'playback/labelsRuntime.ts')))

describe('场景绘制与回放接线合同', () => {


  it('对数深度缓冲：默认开启 + ?logdepth=0 逃生开关 + 两自定义 ShaderMaterial 挂 logdepthbuf 块（#827 F3: Integration Contract（无注入点）+ shader-lint PK）', () => {
    // 回放查看器允许 600–1000m 俯瞰（客户端贴地视角从不涉及）：线性 24bit 深度在该
    // 距离分辨率 4–12cm，与贴地装饰薄板/重建地形的厘米级交叠同量级 → 远景成片
    // z-fighting。对数深度恢复确定性深度序；因每片元写 gl_FragDepth（禁 early-z）
    // 有全局片元开销，?logdepth=0 提供真机回滚与 A/B 性能验收开关。自定义
    // ShaderMaterial 不自动注入 logdepthbuf 代码块，漏挂 = 该材质深度写回线性域，
    // 与其他物体深度语义割裂。
    // 2026-10-07：默认改为**关**（真机 A/B 权衡：每片元 gl_FragDepth + 禁 early-z
    // 对 alpha-test 植被的填充率开销是乘法级）；Display 面板开关 + localStorage
    // 持久化，URL ?logdepth= 仍最高优先（boolPref 解析）。
    expect(src).toMatch(/let LOGDEPTH = boolPref\('pb_logdepth', 'logdepth', false\);?/)
    expect(src).toMatch(/let DYNRES = boolPref\('pb_dynres', 'dynres', true\);?/)
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
    expect(src).toMatch(/S\.vehicles\.markSeekSnap\(\);[\s\S]{0,160}S\.tick\(\);/)
    expect(src).toMatch(/for \(const v of S\.vehicles\.getVehicles\(\)\) S\.vehicles\.applyPose\(v\);[\s\S]{0,80}S\.vehicles\.clearSnap\(\);/)
    expect(src).toMatch(/S\.vehicles\.frameTiming\(dt, false\);[\s\S]{0,120}tick\(\);/)
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
    expect(src).toMatch(/S\.T = advancePlaybackTime\(S\.T, S\.END, dt \* 1000, S\.SPEED\);/)
    expect(src).not.toMatch(/S\.T \+= dt \* S\.SPEED\;/)
  })

  it('setSpeed 只接受档位表内的值（#827 F3: Integration Contract（无注入点）；宿主闭包函数无独立 owner）', () => {
    expect(src).toMatch(/function setSpeed\(s: number\): void \{ if \(!isPlaybackSpeed\(s\)\) return;/)
  })

  it('onResize 单画布取整尺寸 + 置脏重绘（#827 F3: Integration Contract（无注入点）；宿主闭包函数）', () => {
    const resizeStart = src.indexOf('function onResize')
    const resize = src.slice(resizeStart, src.indexOf('function ', resizeStart + 20))
    expect(resize).toMatch(/const w = Math\.max\(1, Math\.round\(P\.container\.clientWidth\)\);/)
    expect(resize).toMatch(/S\.renderer\.setSize\(w, h\);/)
    expect(resize).toMatch(/S\.invalidate\(\);/)
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
    expect(animate).toMatch(/S\.renderer\.render\(S\.scene, S\.camera\);/)
    expect(animate).not.toMatch(/autoClear/)
  })

  it('特效走对象池：到期归池而非 dispose，池只在会话结束时整体释放', () => {
    // 回归：每发/每次命中/每次击毁新建 geometry+material 再 dispose → 交火高峰分配尖峰。
    // 炮线/光迹借还 battleFx 的条带池，命中/开火/爆炸写进 battleFx 的粒子批次
    //（资源唯一 owner 与释放见 battleFx.test.js）；伤害数字已是覆盖层 DOM，没有画布资源可池化。
    // 炮线/光迹借还 battleFx 的条带池（takeRibbon ≥ shots、完成归还、热路径零 dispose）
    // 2026-11-12 接替：battleRuntime.fx.test.ts 行为测试（真实 createBattleRuntime harness）
    expect(src).toMatch(/S\.battle\.dispose\(\);/)
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
    expect(src).toMatch(/function writeHud\(force: boolean = false\)/)
    expect(src).toMatch(/writeHud\(true\);/)
    const tickStart = src.indexOf('function tick()')
    const tick = src.slice(tickStart, src.indexOf('function writeHud'))
    expect(tick).not.toMatch(/P\.store\.time = S\.T;/)
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
    expect(animate).toMatch(/const busy = S\.PLAYING/)
    expect(animate).toMatch(/\|\| cameraMoved/)
    expect(animate).toMatch(/\|\| S\.frameDirty/)
    // 弹道/战斗特效/幽灵闪的活跃判定由 battleRuntime 持有，场景只问 battle.isActive()
    expect(animate).toMatch(/\|\| S\.battle\.isActive\(\);/)
    // 战场标记是回放时钟窗口状态（暂停冻结、无壁钟动画）：不参与 busy 判定
    expect(animate).not.toMatch(/battleMarkers\.hasActive/)
    // tick / seekTo 都走同一条 update(T) 幂等窗口重算（无游标）
    const seekTo = src.slice(src.indexOf('function seekTo'))
    expect(seekTo).toMatch(/S\.battleMarkers\.update\(S\.T\)/)
    // isActive() 真值表 2026-11-12 接替：battleRuntime.fx.test.ts 行为测试
    // 跳帧分支：空闲时只做帧率角标归零，随后 return（不跑 tick / 标签 / render）
    expect(animate).toMatch(/if \(!busy\) \{(?:.|\n){0,600}?return;/)
    expect(animate.indexOf('frameDirty = false;')).toBeGreaterThan(animate.indexOf('if (!busy) {'))
  })
})
})
