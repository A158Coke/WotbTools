// 实时回放 three.js 场景内核：自上游 Agent 前端平移（会话生命周期修复版）。
// 渲染语义（位姿滤波/炮塔随动/弹道动画/分层地表/画质档/GLB 姿态）沿用既有实现；
// 唯一改动是原 DOM 面板触点（$('timer') 等）全部改写 store（playbackStore.ts）。
//
// WotBTools 唯一分叉（评审 P0-3 client-only 拓扑）：资产访问只走 assetProvider
//（?assets= 资产平面），上游的 /api/playback/*、/api/tank 同源服务端回退删除——
// 其余与上游逐行同源，上游渲染/生命周期修复随版本跟随。
//
// 会话生命周期（契约 v2 / 评审 P0-2）：同场景实例换回放必须 teardown 上一场——
// load A → dispose A → load B；路由/组件销毁 → dispose 当前会话。会话拥有的资源
// （车辆低模/GLB 克隆/标签/弹道特效/地图与地表纹理/GLB 模板缓存）显式 dispose，
// 异步资产加载带 generation guard（迟到完成不得污染新会话，迟到的已加载资源随旧
// 会话缓存一并释放）。GLB 模板缓存为 session-scoped：同 tank 会话内复用，会话结束
// 对 unique shared resources dispose 一次并清缓存（clone 共享模板资源，不逐克隆
// 深度 dispose）；cross-session refcount/LRU 不在本层。
/**
 * 拆分模块共享的宿主对象类型（迁移期声明：宿主字段由各 owner 模块安装，逐字段类型化随迁移推进）。
 * @typedef {Record<string, any>} Host
 */

// 2026-11-22 出仓（#820 式拆分）：本文件只保留 initPlayback 接线与公开 re-export；
// 状态初始化/场景装配/帧循环与 perf/播放传输/会话生命周期/公开 API 的 owner 分别在
// ./playback/sceneState.ts、sceneAssembly.ts、renderLoop.ts、transport.ts、
// sessionRuntime.ts、publicApi.ts。跨模块可变状态与函数统一挂在宿主对象 S 上
//（playback/sceneHost.ts），安装顺序见 initPlayback。
import { createSceneHost } from './playback/sceneHost.js'
import { installSceneState } from './playback/sceneState.js'
import { installSceneAssembly } from './playback/sceneAssembly.js'
import { installRenderLoop, installPerfProbe } from './playback/renderLoop.js'
import { installTransport } from './playback/transport.js'
import { installSessionRuntime, createPlaybackSession } from './playback/sessionRuntime.js'
import { createPlaybackApi } from './playback/publicApi.js'
import { QUALITY_PRESETS } from './playback/quality.js'
import { tracerSpanSecs, occlusionCells, occlusionFootprintCells } from './playback/pure.js'
import { COLOR_FRIENDLY, COLOR_ENEMY, COLOR_UNKNOWN, TRACER_FRIENDLY, TRACER_ENEMY } from './playback/palette.ts'

export { QUALITY_PRESETS, tracerSpanSecs, occlusionCells, occlusionFootprintCells }
// 调色常量的消费方（bases.tracers.behavior 测试等）经本文件 re-export 零改动。
export { COLOR_FRIENDLY, COLOR_ENEMY, COLOR_UNKNOWN, TRACER_FRIENDLY, TRACER_ENEMY }

// 兜底灯光（读不到 lighting.json 时用，= 上游硬编码时代的两盏灯，保证无数据也不变样）
// 出屏口径（A2）：客户端发布版**没有任何 filmic 出屏曲线**。证据（客户端 Materials/Shaders
// 解出的 tmp_analysis/shaders，逐行核过）：
//   · Default/pbr-fp.sl:481-491 —— Uncharted2 与 Hejl/Burgess 两段曲线都注释掉，生效行是
//     注释写着 "Linear to sRGB conversion without tonemapping" 的 LinearToSRGB（坦克走这条）；
//   · Default/materials-fp.sl:385 —— 非 PBR 材质直写 outColor、不做任何变换（我们的自定义
//     伽马空间着色器同口径；本开关只作用于走 three 内建管线的材质 = 坦克，地面/布景不受影响）；
//   · Utilities/exposure-tonemapping-fp.sl:28-30 —— `1 - exp(-lum × exposure)` 同样注释掉，
//     生效行 `output.color.rgb = luminanceSample * exposure`（线性 × 曝光，**乘在显示空间**）。
// 出屏口径 = **客户端同式**：three 的 LinearToneMapping（`saturate(exposure × 线性色)` → sRGB 编码）
// 等价于客户端"线性 × 曝光 → 编码"；曝光取 1.0 = 纯客户端材质数学。不设 ?tonemap/?exposure 旋钮：
// 客户端曝光是**屏幕级自动曝光**（`[auto] property float exposure`），全客户端数据没有一个静态值
// 可抄 ⇒ 引入替代参数只会得到"必须手工调才对"的状态（2026-10-10 按此原则撤掉）。
// 共面接缝（地形与挡土墙顶/建筑基础**吸附齐平**，实测沿缝 92% |Δ|≤1 cm）不做任何人工深度偏移
// 或几何让步：客户端两条手法都没有——材质层 52/52 无 `DepthBias`/`SlopeScaleDepthBias`（见 docs），
// 几何层同一份数据同样共面。我们俯瞰时缝上的逐像素抢胜与客户端同源，属**相机差异**而非实现差异；
// 2026-10-10 按"只保留客户端有实际依据者"撤掉了此前的 `?poff` 与 `?seamfix` 两处人工补偿。
// 兜底灯光常量与逐图光照应用体自 2026-10-14 起在共享模块 mapLighting.js（SSOT，与俯视烘焙
// 同一份）：DEFAULT_HEMI_* / DEFAULT_SUN_INTENSITY 见文件头导入。

// 资产加载并发上限与有限并发映射在 ./playback/util.js（ASSET_CONCURRENCY / mapLimit）。

// 四档渲染预设（QUALITY_PRESETS，含档位语义注释）在 ./playback/quality.js；
// 纯函数 tracerSpanSecs / occlusionCells / occlusionFootprintCells 在 ./playback/pure.js
//（本文件 re-export，导入方零改动）。

/**
 * @param {HTMLElement} container
 * @param {ReturnType<import('./playbackStore').createPlaybackStore>} store
 * @param {HTMLElement | null} labelOverlay
 * @param {{onVehicleSelect?: (eid: number | null, event: MouseEvent | null) => void, onAnnotationCommit?: ReturnType<import('../composables/useSceneAnnotations').useSceneAnnotations>['commitAnnotationFromScene'], onAnnotationErase?: ReturnType<import('../composables/useSceneAnnotations').useSceneAnnotations>['eraseFromScene'], recorderReticle?: HTMLElement | null}} [options]
 */

export function initPlayback(container, store, labelOverlay = null, { onVehicleSelect, onAnnotationCommit, onAnnotationErase, recorderReticle = null } = {}) {
  const S = createSceneHost({
    container, store, labelOverlay, onVehicleSelect, onAnnotationCommit, onAnnotationErase, recorderReticle,
  })
  installSceneState(S)
  installRenderLoop(S)
  installTransport(S)
  installSessionRuntime(S)
  installSceneAssembly(S)
  installPerfProbe(S)
  // 初始化：事件绑定 + 动画循环（渲染器惰性创建，画质选择先于首帧定型）
  createPlaybackSession(S)
  S.animate()
  S.applyGlbGate()

  return createPlaybackApi(S)
}
