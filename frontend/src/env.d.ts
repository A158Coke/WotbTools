/// <reference types="vite/client" />

declare const __BUILD_COMMIT__: string
declare const __BUILD_TIME__: string

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
  __mapLighting?: { direction?: number[]; color?: unknown; intensity?: unknown; ambient?: unknown }
  __mapExposure?: number
  __skyMeshes?: number
  __waterCoast?: { present?: boolean; span?: number; materials?: number }
  __prunedVariantNodes?: number
  __animLayerMats?: number
  __sceneryAniso?: { value: number; textures: number }
  __destructStage?: string
  __terrainRefineMask?: { meshes: number; texels: number }
  __destructDebug?: () => Record<string, unknown>
  __wotbMap2d?: unknown
  __pbPick?: unknown
  __pbPickText?: string
  __pbPickMesh?: unknown
  __scene?: unknown
  __renderer?: unknown
  __camera?: unknown
  __controls?: unknown
  __setFollow?: unknown
  __threeCamera?: unknown
  __renderInfo?: () => { calls: number; triangles: number }
  __cameraInfo?: () => { pos: number[] | null; mode: string | null }
  __debugView?: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => boolean
  __rows?: (fracs: number[]) => number[][] | null
  __forceFrame?: () => { calls: number; triangles: number; pixel: number[]; size: number[] } | null
  __waterReflection?: unknown
  __TAURI__?: unknown
  __mapBorderNodes?: string[]
  __waterMerged?: unknown
  __waterMats?: unknown
  __grassStage?: string
  __grass?: unknown
  __mapBorderMaterials?: number
  __waterMaterials?: number
  __pbV?: unknown
  __gdbg?: unknown
  __battleFx?: unknown
  __pbPerf?: unknown
  __ambient?: { mapMode?: boolean; frozen?: boolean; mats?: number; frames?: number; paused?: boolean; dtMs?: number }
}
