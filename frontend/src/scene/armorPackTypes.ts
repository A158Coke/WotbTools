// 碰撞包数据面类型（自 armorCollisionPack.ts 原样平移；仅供各 armorPack* 模块与
// armorCollisionPack.ts 门面共享，运行时无行为）。
import type { Mesh, Vector3, Texture } from 'three';

export type ArmorSection = 'hull' | 'turret' | 'gun' | 'spaced' | 'chassis' | 'gunBarrel'

/** buildPack 的输入条目（装甲板/外部模块碰撞几何；variant 仅模块去重用）。 */
export interface PackEntry {
  mesh: Mesh
  section: ArmorSection
  thickness: number
  variant: 'track' | 'gun' | null
}

/** 打包单元（大网格按连续三角形段分块；同 section/thickness/variant/矩阵）。 */
export interface PackUnit {
  mesh: Mesh
  section: ArmorSection
  thickness: number
  /** variant 去重位（VARIANTS 位掩码；非模块 = 0） */
  variant: number
  triStart: number
  triCount: number
  /** 该块在源几何内的起始三角形（分块网格 >256 三角形） */
  localFrom: number
}

/** buildPack 成功结果（调用方在 ok=false 时必须禁用续飞，fail-closed）。 */
export interface CollisionPack {
  ok: true
  units: PackUnit[]
  meshes: Mesh[]
  meshCount: number
  triTotal: number
  triRows: number
  triData: Float32Array
  metaData: Float32Array
  matsData: Float32Array
  /** updatePackMatrices 每帧计算的世界包围盒（着色器早退 uniform 用） */
  worldMin?: [number, number, number]
  worldMax?: [number, number, number]
  /** GPU 纹理句柄（调用方持有；矩阵更新时置 needsUpdate） */
  textures?: { matsTex: Texture } | null
}

export interface CollisionPackFailure {
  ok: false
  reason: string
}

export type BuildPackResult = CollisionPack | CollisionPackFailure

/** raycastPackAll 的命中条目（全量、按 t 升序、世界系输出）。 */
export interface CollisionHit {
  t: number
  meshIdx: number
  section: string
  thickness: number
  triangleId: number
  /** variant 去重位（0 = 非模块/间隙/主装） */
  variant: number
  /** 全局三角形槽（网格验证用） */
  slot: number
  point: Vector3
  normal: Vector3
}

/** raycastGridAll 的命中条目（不输出 point 之外的归属信息；HE 采样只消费 t/section/thickness）。 */
export interface GridCollisionHit {
  t: number
  section: string
  thickness: number
  variant: null
  slot: number
  normal: Vector3
  point: Vector3
}

/** buildRicochetGrid 成功结果（GPU DDA 求交数据面）。 */
export interface RicochetGrid {
  ok: true
  dims: number[]
  cellSize: number
  gridMin: [number, number, number]
  cellTotal: number
  entryTotal: number
  triRows: number
  cellsData: Float32Array
  entriesData: Float32Array
  worldTrisData: Float32Array
}

export type BuildRicochetGridResult = RicochetGrid | { ok: false; reason: string }

/** simulateContinuation 的单层快照（调试/测试用）。 */
export interface ContinuationLayer {
  meshName: string
  plateId?: unknown
  triangleId: number
  slot: number
  point: number[]
  normal: number[]
  section: string
  t: number
  thickness: number
  eff: number
  remBefore: number
  penetrated: boolean
  ricochet: boolean
  angle?: number
  seg: number
}
