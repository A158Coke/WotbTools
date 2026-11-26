import * as THREE from 'three'
import { vi } from 'vitest'
import type { MarkerRuntimeDeps } from './markerRuntime.js'

export interface Harness {
  deps: MarkerRuntimeDeps
  t: { v: number }
  scene: { added: THREE.Object3D[]; removed: THREE.Object3D[] }
  poses: Map<number, { x: number; z: number } | null>
  posesAt: Map<number, { z: number; at(t: number): number }>
  sources: Map<number, { nickname?: string; tank_name?: string; tank_id?: number } | null>
  byNickname: Map<string, { nickname?: string; tank_name?: string; tank_id?: number } | null>
  invalidate: ReturnType<typeof vi.fn>
}

export function makeHarness(opts: {
  poses?: Map<number, { x: number; z: number } | null>
  posesAt?: Map<number, { z: number; at(t: number): number }>
  sources?: Map<number, { nickname?: string; tank_name?: string; tank_id?: number } | null>
  byNickname?: Map<string, { nickname?: string; tank_name?: string; tank_id?: number } | null>
} = {}): Harness {
  const t = { v: 100 }
  const scene = {
    added: [] as THREE.Object3D[],
    removed: [] as THREE.Object3D[],
    add(o: THREE.Object3D) { scene.added.push(o) },
    remove(o: THREE.Object3D) { scene.removed.push(o) },
  }
  const poses = opts.poses ?? new Map()
  const posesAt = opts.posesAt ?? new Map()
  const sources = opts.sources ?? new Map()
  const byNickname = opts.byNickname ?? new Map()
  const invalidate = vi.fn()
  const deps: MarkerRuntimeDeps = {
    getScene: () => scene as unknown as THREE.Scene,
    groundY: () => 3,
    getVehiclePose: (eid, _t, out) => {
      const p = poses.get(eid)
      if (!p) return false
      out.set(p.x, 3, p.z)
      return true
    },
    getPoseAt: (eid, t, out) => {
      const p = posesAt.get(eid)
      if (!p) return false
      out.set(p.at(t), 3, p.z)
      return true
    },
    describeSource: (eid, accountId) => sources.get(eid) ?? sources.get(accountId) ?? null,
    findByNickname: (nickname) => byNickname.get(nickname) ?? null,
    tankNameOf: (tankId) => (tankId === 14129 ? 'Tiger II' : undefined),
    getT: () => t.v,
    invalidate,
  }
  return { deps, t, scene, poses, posesAt, sources, byNickname, invalidate }
}

export const attention = (t: number, target: number, sender = '发布者') => ({
  t, kind: 'command' as const, raw_type: 1, channel: 0, sender,
  command_name: 'attention_to_cell', target,
})
