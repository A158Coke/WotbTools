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

  it('材质缓存随会话释放（勿复用已 dispose 实例）', () => {
    // 必须在 teardownSession 里清空——mapScenery 在同一段被 dispose，缓存留着就会
    // 复用已释放的材质实例
    const at = src.indexOf('function teardownSession')
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at, at + 4000)).toMatch(/sceneryMatCache\.clear\(\);/)
  })

  it('叶卡走不透明管线：transparent=false + uAlphaCut discard（消除互遮挡闪烁）', () => {
    // 回归：transparent=true + depthWrite=true 二者冲突 → 叶片互相遮挡破洞/闪烁
    expect(src).toMatch(/const CARD_ALPHA_CUT = 0\.33/)
    const billboard = src.slice(src.indexOf('function makeBillboardMaterial'),
                                src.indexOf('async function loadMapImage'))
    expect(billboard).toMatch(/uAlphaCut: \{ value: CARD_ALPHA_CUT \}/)
    expect(billboard).toMatch(/if \(c\.a < uAlphaCut\) discard;/)
    expect(billboard).toMatch(/transparent: false,/)
  })

  it('叶卡材质取自身 occMean 与 SH 染色（不硬编码 1.77、不读 extras）', () => {
    const billboard = src.slice(src.indexOf('function makeBillboardMaterial'),
                                src.indexOf('async function loadMapImage'))
    expect(billboard).toMatch(/Number\(m\.userData\.occMean\)/)
    expect(billboard).not.toMatch(/userData\.extras/)
    expect(billboard).toMatch(/uSH: \{ value: shTint \}/)
    expect(billboard).not.toMatch(/uSH: \{ value: 1\.77 \}/)
  })

  it('伪透明转不透明 + 裁切，真透明不写深度', () => {
    expect(src).toMatch(/const pseudoOpaque = !!m\.transparent && \(m\.opacity \?\? 1\) >= 0\.99;/)
    expect(src).toMatch(/transparent: !!m\.transparent && !pseudoOpaque,/)
    expect(src).toMatch(/if \(pseudoOpaque\) nm\.alphaTest = Math\.max\(nm\.alphaTest \|\| 0, 0\.33\);/)
    expect(src).toMatch(/if \(nm\.transparent\) nm\.depthWrite = false;/)
    // 镂空贴图必须继承 GLTFLoader 解析好的 alphaTest（MASK 裁切，否则整片方片照绘）
    expect(src).toMatch(/if \(m\.alphaTest > 0\) nm\.alphaTest = m\.alphaTest;/)
  })

  it('ST| 按不透明度分流（伪透明不透明化），toneMapped 关闭', () => {
    const st = src.slice(src.indexOf("if ((m.name || '').startsWith('ST|'))"))
    expect(st.slice(0, 800)).toMatch(/transparent: !opaqueEnough,/)
    expect(st.slice(0, 800)).toMatch(/bm\.alphaTest = opaqueEnough \? 0\.33 : 0\.05;/)
    expect(st.slice(0, 800)).toMatch(/bm\.toneMapped = false;/)
  })

  it('退化几何守卫 + ?degrade=N 覆盖（撕裂批次不渲染/不占 draw call）', () => {
    expect(src).toMatch(/const degradedMeshes = \[\];/)
    expect(src).toMatch(/const q = Number\(new URLSearchParams\(location\.search\)\.get\('degrade'\)\);/)
    expect(src).toMatch(/if \(vc > 0 && \(ic \/ 3\) \/ vc > degLimit\) degradedMeshes\.push\(o\);/)
    expect(src).toMatch(/o\.removeFromParent\(\);/)
  })

  it('水体：透明面写深度 + 双面 + 不设 renderOrder', () => {
    expect(src).toMatch(/const isWaterName = \(n\) => \/water\|sea\|lake\|river\|fountain\/i\.test\(n \|\| ''\);/)
    const water = src.slice(src.indexOf('if (isWaterName(o.name))'))
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
    expect(src).toMatch(/const LOGDEPTH = \(\(\) => \{ try \{ return new URLSearchParams\(location\.search\)\.get\('logdepth'\) !== '0'; \} catch \(e\) \{ return true; \} \}\)\(\);/)
    expect(src).toMatch(/logarithmicDepthBuffer: LOGDEPTH/)
    // logdepthbuf_vertex 调用 isPerspectiveMatrix（定义在 <common>）：自定义 vertex
    // shader 必须 include <common>，否则 GLSL 编译失败、材质整片不渲染
    const billboard = src.slice(src.indexOf('function makeBillboardMaterial'),
                                src.indexOf('async function loadMapImage'))
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
    expect(src).toMatch(/const SCENERY_LAMBERT_EXPOSURE = 0\.75/)
    expect(src).toMatch(/\.multiplyScalar\(SCENERY_LAMBERT_EXPOSURE\)/)
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
    expect(publish, 'T 未变 / 未到节流窗口时不得重复求值').toMatch(/if \(!force && \(T === labelsTime \|\| now - labelsWrittenMs < 100\)\) return;/)
    // 求值本身只依赖 T（纯状态在时刻）：走共享 resolver，不再自带累加计时器
    expect(publish).toMatch(/reload: destroyed \? null : reloadStateAt\(v\.def\.eid, T, v\.reloadSize\)/)
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
    expect(src).toMatch(/poseFromYPR\(-yawAt\(v, T\), arrAt\(v\.def\.hull_pitch, T\), -rollAt\(v, T\), _glbQuat\)/)
    const glb = src.slice(src.indexOf('function poseGlb'), src.indexOf('async function applyGlbToggle'))
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
    expect(src).toMatch(/poseFromYPR\(-yawAt\(v, T\), arrAt\(v\.def\.hull_pitch, T\), -rollAt\(v, T\), _glbQuat\)/)
    expect(src).toMatch(/v\.group\.rotation\.z = -rollAt\(v, T\);/)
  })

  it('横滚与偏航符号同号、俯仰不受影响（镜像约定的可判据部分）', () => {
    // 注释里的完整推导不入断言（src 已剥注释）；这里只锁「yaw 取负 ⇒ roll 也取负」这一约定
    expect(src).toMatch(/-yawAt\(v, T\)/)
    expect(src).toMatch(/-rollAt\(v, T\)/)
    expect(src).not.toMatch(/\+rollAt\(v, T\)/)
  })
})
