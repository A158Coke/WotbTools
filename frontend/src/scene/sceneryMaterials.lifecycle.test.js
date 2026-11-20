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
const basesSrc = readSrc(resolve(here, 'playback/bases.ts'), 'utf8')
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const mapWorldSrc = stripComments(readSrc(resolve(here, 'playback/mapWorld.ts')))
const vehSrc = stripComments(readSrc(resolve(here, 'playback/vehicleRuntime.ts')))

describe('场景生命周期与反馈合同', () => {


describe('车体横滚（hull_roll）接线守卫', () => {
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
    // 基地环/圆盘材质随基地系统出仓 playback/bases.js（守卫随实现迁移）
    expect(basesSrc, '基地环').toMatch(/color: baseColors\.neutral[\s\S]{0,200}toneMapped: false/)
    expect(basesSrc, '基地圆盘').toMatch(/map: tex, side: THREE\.DoubleSide[\s\S]{0,160}toneMapped: false/)
    const sites = [
      [/color: 0xe8b23c[\s\S]{0,160}toneMapped: false/, '作者标记环'],
    ]
    for (const [re, label] of sites) expect(vehSrc, label).toMatch(re)
    // 炮线 / 光迹 / 命中 / 开火 / 爆炸的材质在 battleFx：其 toneMapped=false 由 battleFx.test.js 按真实材质断言
  })

  it('着色器预热：场景就绪时 compile 一次（首次开火才编译＝开局/接火卡顿）', () => {
    // 实现出仓 playback/shaderPrewarm.ts（源码行预算回归 1500）；façade 保留接线 + 会话启动路径
    expect(src).toMatch(/const prewarmShaders = createShaderPrewarm\(/)
    const prewarmSrc = readSrc(resolve(here, 'playback/shaderPrewarm.ts'))
    expect(prewarmSrc).toMatch(/compile\(/)
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



describe('地形 LOD 滞回与构建判据同源（review P2 回归锁）', () => {
  // 缺陷（2026-10-10 review）：maybeRebuildTerrainLod 只把"相机到 controls.target 的视距"
  // 喂给滞回，而 buildAdaptiveTerrain 的判据读相机三维位置/FOV/aspect ⇒ 绕目标水平旋转
  // （视距恒等）时网格永远不重建，停在旧相机位置的 LOD 分布上。onResize 同理只改投影
  // 不重建地形。守卫：重建入口必须传相机姿态快照（terrainLodState），不得退回只比视距。
  it('maybeRebuildTerrainLod 消费 terrainLodState(camera, controls.target, camera.aspect)', () => {
    const start = mapWorldSrc.indexOf('function maybeRebuildTerrainLod')
    expect(start).toBeGreaterThan(0)
    const fn = mapWorldSrc.slice(start, mapWorldSrc.indexOf('\n  }', start))
    expect(fn).toMatch(/terrainLodState\(camera, controls\.target, camera\.aspect\)/)
    expect(fn).not.toMatch(/terrainLodDist/)
    expect(fn).toMatch(/terrainLodStaleReason\(terrainLodPrev, cur, now - terrainLodAt\)/)
  })

  // PR #954 评审 F3/F4：宿主停手后不再有帧会走到 maybeRebuildTerrainLod，换装/异步失败
  // 都必须显式安排一次最终姿态复查，不能只依赖「下一帧」。
  it('换装后的最终姿态与异步失败都会唤醒宿主，提交/回退后撤销待唤醒', () => {
    const swapStart = mapWorldSrc.indexOf('function applyTerrainSwap')
    expect(swapStart).toBeGreaterThan(0)
    const swap = mapWorldSrc.slice(swapStart, mapWorldSrc.indexOf('function maybeRebuildTerrainLod', swapStart))
    // 换装快照与当前相机不一致 → 节流到期唤醒；一致 → 撤销旧唤醒。
    expect(swap).toMatch(/terrainLodPoseReason\(job\.snapshot, terrainLodState\(camera, controls\.target, camera\.aspect\)\)/)
    expect(swap).toMatch(/terrainLodWake\.scheduleElapsed\(/)
    expect(swap).toMatch(/terrainLodWake\.cancel\(\)/)
    // 异步 Worker 失败：停手时也要有脏帧才能进同步回退。
    expect(mapWorldSrc).toMatch(/onWorkerLost:[\s\S]{0,800}?deps\.invalidate\(\)/)
    // 在途结果被 setMask/setSource 作废后：丢弃路径同样要唤醒宿主重评估（停手没有下一帧）。
    expect(mapWorldSrc).toMatch(/onDiscard: \(\) => deps\.invalidate\(\)/)
    // 已按当前姿态发出 / 同步回退 / 会话重置 / 销毁：待唤醒不再需要。
    expect(mapWorldSrc.match(/terrainLodWake\.cancel\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(mapWorldSrc).toMatch(/if \(sch\.request\([^\n]*\)\) \{[^}]*terrainLodWake\.cancel\(\)/)
    expect(mapWorldSrc).toMatch(/terrainLodWake\.cancel\(\);\s*\n\s*terrainLodPrev = cur;/)
  })
})
})
