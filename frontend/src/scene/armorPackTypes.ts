import type { Mesh, Vector3, Texture } from 'three';

export type ArmorSection = 'hull' | 'turret' | 'gun' | 'spaced' | 'chassis' | 'gunBarrel'

export interface PackEntry {
  mesh: Mesh
  section: ArmorSection
  thickness: number
  variant: 'track' | 'gun' | null
}

export interface PackUnit {
  mesh: Mesh
  section: ArmorSection
  thickness: number
  variant: number
  triStart: number
  triCount: number
  localFrom: number
}

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
  worldMin?: [number, number, number]
  worldMax?: [number, number, number]
  textures?: { matsTex: Texture } | null
}

export interface CollisionPackFailure {
  ok: false
  reason: string
}

export type BuildPackResult = CollisionPack | CollisionPackFailure

export interface CollisionHit {
  t: number
  meshIdx: number
  section: string
  thickness: number
  triangleId: number
  variant: number
  slot: number
  point: Vector3
  normal: Vector3
}

export interface GridCollisionHit {
  t: number
  section: string
  thickness: number
  variant: null
  slot: number
  normal: Vector3
  point: Vector3
}

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
