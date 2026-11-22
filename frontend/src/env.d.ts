/// <reference types="vite/client" />

declare const __BUILD_COMMIT__: string
declare const __BUILD_TIME__: string

/** GeckoView 内置扩展注入的 Bridge；页面只信任收窄后的回复，成员都可能缺失。 */
interface NativeBridgeTransport {
  postMessage?: (message: string) => void
  addEventListener?: (type: 'message', listener: (event: { data: unknown }) => void) => void
  removeEventListener?: (type: 'message', listener: (event: { data: unknown }) => void) => void
}

interface Window {
  WotbNative?: NativeBridgeTransport
  wotbtoolsOnAuthChanged?: () => unknown
  wotbtoolsOnConnectivityChanged?: () => unknown
  wotbtoolsOnReplay?: () => unknown
  __pbReplaySource?: unknown
  /** 逐图光照调试（?debug；mapLighting.ts 写入） */
  __mapLighting?: { direction?: number[]; color?: unknown; intensity?: unknown; ambient?: unknown }
  /** 逐图曝光调试（?debug；mapLighting.ts 写入） */
  __mapExposure?: number
  /** 场景装配调试计数（?debug；sceneryAssembly.ts 写入） */
  __skyMeshes?: number
  /** 水面海岸线调试（mapAssets.ts 写入：present/span；sceneryAssembly.ts 累加 materials） */
  __waterCoast?: { present?: boolean; span?: number; materials?: number }
  /** 变体裁剪计数（mapAssets.ts ?debug 写入） */
  __prunedVariantNodes?: number
  /** 动画混合层材质数（mapAssets.ts ?debug 写入） */
  __animLayerMats?: number
  /** 场景各向异性诊断（mapAssets.ts ?debug 写入） */
  __sceneryAniso?: { value: number; textures: number }
  /** 可破坏物装配阶段诊断（mapAssets.ts ?debug 写入） */
  __destructStage?: string
  /** 走廊掩码诊断（mapAssets.ts ?debug 写入） */
  __terrainRefineMask?: { meshes: number; texels: number }
  /** 可破坏物明细诊断（mapAssets.ts ?debug 写入） */
  __destructDebug?: () => Record<string, unknown>
  /** map2d OTA 覆盖层诊断面（map2dOverlay Android/DEV 挂载） */
  __wotbMap2d?: unknown
  /** 拾取报告调试（pickReport ?debug 写入；面板/console/window 三渠道同一份） */
  __pbPick?: unknown
  __pbPickText?: string
  __pbPickMesh?: unknown
  /** 3D 场景核心诊断钩子（renderer.ts ?debug 写入；仅创建后引用） */
  __scene?: unknown
  __renderer?: unknown
  __camera?: unknown
  __controls?: unknown
  __setFollow?: unknown
  /** ?debug 诊断探针（playback/debugProbes.ts 写入；仅 debug 构建挂载） */
  __threeCamera?: unknown
  __renderInfo?: () => { calls: number; triangles: number }
  __cameraInfo?: () => { pos: number[] | null; mode: string | null }
  __debugView?: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => boolean
  __rows?: (fracs: number[]) => number[][] | null
  __forceFrame?: () => { calls: number; triangles: number; pixel: number[]; size: number[] } | null
  /** 水面反射运行时句柄（waterReflectionRuntime.ts ?debug 写入） */
  __waterReflection?: unknown
  /** Tauri 运行时标记（webview 内由宿主注入） */
  __TAURI__?: unknown
  /** 地图资产 ?debug 诊断面（mapAssets/mapWorld/sceneryAssembly 写入） */
  __mapBorderNodes?: string[]
  __waterMerged?: unknown
  __waterMats?: unknown
  __grassStage?: string
  __grass?: unknown
  __mapBorderMaterials?: number
  __waterMaterials?: number
  /** 场景车辆调试句柄（sessionRuntime/sessionLifecycle ?debug 写入） */
  __pbV?: unknown
  /** 场景调试聚合（?debug 写入） */
  __gdbg?: unknown
  /** 战斗特效调试句柄（?debug 写入） */
  __battleFx?: unknown
  /** ?perf 看门狗句柄（perfProbe 写入，销毁时摘除） */
  __pbPerf?: unknown
  /** 环境动画逐帧诊断（renderLoop.ts ?debug 写入） */
  __ambient?: { mapMode?: boolean; frozen?: boolean; mats?: number; frames?: number; paused?: boolean; dtMs?: number }
}
