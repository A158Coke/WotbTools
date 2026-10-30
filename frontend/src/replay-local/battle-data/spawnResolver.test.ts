import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AgentAuthorInitialPosition } from '../../api/agent-replay-facets.js'
import type { components } from '../../api/generated/http-contract.js'
import { wasm } from '../__golden__/agentWasmNode.js'
import { indexMapGridProfiles, parseMapGridProfile } from '../playback/toMapOverview.js'
import { resolvePhysicalSpawns } from './spawnResolver.js'

type Side = components['schemas']['BattleDataSpawn']
const point = (team: number, x: number, y: number) => ({
  team, type: 'spawnpoint', position: [x, y, 30], confidence: 'EXACT_SCENE_DATA',
})
function semantic(a: Side = 'NORTH', b: Side = 'SOUTH') {
  return {
    mapId: 'example', mapCodes: ['alias'], verified: true,
    playableBoundsMeters: { xMin: -100, xMax: 100, yMin: -100, yMax: 100 },
    analysisGrid: { cells: [{ id: 'A1', boundsMeters: { xMin: -100, xMax: 100, yMin: -100, yMax: 100 } }] },
    spawnSemantics: { TEAM_1: { status: 'EXACT_SCENE_DATA', physicalSide: a }, TEAM_2: { status: 'EXACT_SCENE_DATA', physicalSide: b } },
    sceneEvidence: { battlePoints: [point(1, 20, 40), point(2, -20, -40)] },
  }
}
const probe = (x = 20, y = 40, clock = 0.5): AgentAuthorInitialPosition => ({
  author_eid: 7, clock, position: [x, 987, y],
})

describe('physical spawn: reviewed canonical data and bounded evidence', () => {
  it.each<[Side, Side]>([['NORTH', 'SOUTH'], ['SOUTH', 'NORTH'], ['WEST', 'EAST'], ['EAST', 'WEST']])(
    'maps scene %s/%s independently of replay team', (a, b) => {
      const profiles = indexMapGridProfiles([semantic(a, b)])
      expect(resolvePhysicalSpawns('alias', 1, probe(), profiles)).toEqual({ team1: a, team2: b })
      expect(resolvePhysicalSpawns('alias', 2, probe(), profiles)).toEqual({ team1: b, team2: a })
      expect(resolvePhysicalSpawns('alias', 1, probe(-20, -40), profiles)).toEqual({ team1: b, team2: a })
    },
  )
  it.each([0, 1])('accepts clock boundary %s and exactly 2 meters', (clock) => {
    expect(resolvePhysicalSpawns('alias', 1, probe(22, 40, clock), indexMapGridProfiles([semantic()]))).toEqual({ team1: 'NORTH', team2: 'SOUTH' })
  })
  it.each([-0.001, 1.001, NaN, Infinity])('drops invalid or late clock %s', (clock) => {
    expect(resolvePhysicalSpawns('alias', 1, probe(20, 40, clock), indexMapGridProfiles([semantic()]))).toBeNull()
  })
  it('does not match a distant nearest point, unknown alias or invalid author team', () => {
    const profiles = indexMapGridProfiles([semantic()])
    expect(resolvePhysicalSpawns('alias', 1, probe(22.001, 40), profiles)).toBeNull()
    expect(resolvePhysicalSpawns('unknown', 1, probe(), profiles)).toBeNull()
    expect(resolvePhysicalSpawns('alias', 0, probe(), profiles)).toBeNull()
    expect(resolvePhysicalSpawns('alias', 1, null, profiles)).toBeNull()
  })
  it.each([0, 1, 2])('rejects non-finite world axis %s', (axis) => {
    const p = probe(); p.position[axis] = NaN
    expect(resolvePhysicalSpawns('alias', 1, p, indexMapGridProfiles([semantic()]))).toBeNull()
  })
  it('drops overlapping physical sides instead of choosing the nearest', () => {
    const s = semantic(); s.sceneEvidence.battlePoints[1] = point(2, 21, 40)
    expect(resolvePhysicalSpawns('alias', 1, probe(), indexMapGridProfiles([s]))).toBeNull()
  })
  it.each<[Side, Side]>([['NORTH', 'NORTH'], ['NORTH', 'EAST'], ['SOUTH', 'WEST']])('rejects noncomplementary %s/%s', (a, b) => {
    expect(resolvePhysicalSpawns('alias', 1, probe(), indexMapGridProfiles([semantic(a, b)]))).toBeNull()
  })
  it('requires reviewed exact metadata and finite exact spawn coordinates', () => {
    for (const mutate of [
      (s: ReturnType<typeof semantic>) => { s.verified = false },
      (s: ReturnType<typeof semantic>) => { s.spawnSemantics.TEAM_1.status = 'UNKNOWN' },
      (s: ReturnType<typeof semantic>) => { Reflect.deleteProperty(s.spawnSemantics.TEAM_1, 'physicalSide') },
      (s: ReturnType<typeof semantic>) => { s.sceneEvidence.battlePoints[0].confidence = 'NAME_HEURISTIC' },
      (s: ReturnType<typeof semantic>) => { s.sceneEvidence.battlePoints[0].position[0] = NaN },
      (s: ReturnType<typeof semantic>) => { Reflect.deleteProperty(s.sceneEvidence.battlePoints[0], 'position') },
    ]) {
      const s = semantic(); mutate(s)
      expect(parseMapGridProfile(s)?.physicalSpawns).toBeUndefined()
      expect(resolvePhysicalSpawns('alias', 1, probe(), indexMapGridProfiles([s]))).toBeNull()
    }
  })
  describe('canonical semantic files', () => {
    type Document = { mapId: string; mapCodes?: string[]; spawnSemantics: Record<string, { physicalSide: Side; centroidMeters: { x: number; y: number } }> }
    const documents = Object.values(import.meta.glob('../../../../common/map-semantics/*.semantic.json', { eager: true, import: 'default' })) as Document[]
    const profiles = indexMapGridProfiles(documents)
    const centroid = (points: { x: number; y: number }[]) => ({
      x: points.reduce((total, p) => total + p.x, 0) / points.length,
      y: points.reduce((total, p) => total + p.y, 0) / points.length,
    })

    it('covers every semantic file', () => expect(documents).toHaveLength(33))
    it.each(documents.map(document => [document.mapId, document] as const))('%s binds each side to its own exact spawn group', (mapId, document) => {
      const groups = profiles.get(mapId)?.physicalSpawns
      expect(groups).toHaveLength(2)
      // The side declared on a semantic group must land on that group's scene points.
      for (const [index, team] of ['TEAM_1', 'TEAM_2'].entries()) {
        const declared = document.spawnSemantics[team]
        expect(groups![index].side).toBe(declared.physicalSide)
        expect(centroid(groups![index].points).x).toBeCloseTo(declared.centroidMeters.x, 2)
        expect(centroid(groups![index].points).y).toBeCloseTo(declared.centroidMeters.y, 2)
      }
      const [a, b] = groups!.map(group => ({ side: group.side, ...centroid(group.points) }))
      if (a.side === 'NORTH') expect(a.y).toBeGreaterThan(b.y)
      if (a.side === 'SOUTH') expect(a.y).toBeLessThan(b.y)
      if (a.side === 'WEST') expect(a.x).toBeLessThan(b.x)
      if (a.side === 'EAST') expect(a.x).toBeGreaterThan(b.x)
      // Every exact point resolves to its own side; replay team only chooses which team receives it.
      for (const group of groups!) {
        const other = groups!.find(item => item !== group)!.side
        for (const p of group.points) {
          expect(resolvePhysicalSpawns(mapId, 1, probe(p.x, p.y), profiles)).toEqual({ team1: group.side, team2: other })
          expect(resolvePhysicalSpawns(mapId, 2, probe(p.x, p.y), profiles)).toEqual({ team1: other, team2: group.side })
        }
      }
    })
    it('keeps Copperfield west/east and every other map north/south', () => {
      for (const document of documents) {
        const sides = profiles.get(document.mapId)!.physicalSpawns!.map(group => group.side)
        expect(sides).toEqual(document.mapId === '23_karieri_kr' ? ['WEST', 'EAST'] : expect.arrayContaining(['NORTH', 'SOUTH']))
      }
    })
    it('resolves Neptune by position: the north scene group is NORTH', () => {
      const north = profiles.get('neptune')!.physicalSpawns!.find(group => group.side === 'NORTH')!
      expect(centroid(north.points).y).toBeGreaterThan(200)
      expect(resolvePhysicalSpawns('neptune', 2, probe(108.1868, 222.9614), profiles)).toEqual({ team1: 'SOUTH', team2: 'NORTH' })
    })
    it('still drops a real map probe past two meters or one second', () => {
      const point = profiles.get('karieri')!.physicalSpawns![0].points[0]
      expect(resolvePhysicalSpawns('karieri', 1, probe(point.x + 2.001, point.y), profiles)).toBeNull()
      expect(resolvePhysicalSpawns('karieri', 1, probe(point.x, point.y, 1.001), profiles)).toBeNull()
    })
  })
  it('resolves a real Malinovka fixture from independent scene coordinates', async () => {
    const bytes = readFileSync(fileURLToPath(new URL('../../../../common/fixtures/replays/cw-training-15-14-example.wotbreplay', import.meta.url)))
    const agent = await wasm()
    const result = JSON.parse(agent.parseResult(bytes))
    const position = JSON.parse(agent.parseAuthorInitialPosition!(bytes)) as AgentAuthorInitialPosition
    expect(result.map_key).toBe('malinovka')
    expect(result.arena_bonus_type).toBe(2) // 非采集模式，仅验证位置及方向。
    expect(result.author_team).toBe(2)
    expect(Math.hypot(position.position[0] - 229.885, position.position[2] + 143.6585)).toBeLessThan(0.001)
    expect(resolvePhysicalSpawns(result.map_key, result.author_team, position)).toEqual({ team1: 'NORTH', team2: 'SOUTH' })
  })
  it('drops the real Normandy fixture because the first observation is later than one second', async () => {
    const bytes = readFileSync(fileURLToPath(new URL('../../../../common/fixtures/replays/tournament-14-14-example.wotbreplay', import.meta.url)))
    const agent = await wasm()
    const result = JSON.parse(agent.parseResult(bytes))
    const position = JSON.parse(agent.parseAuthorInitialPosition!(bytes)) as AgentAuthorInitialPosition
    expect(result.map_key).toBe('neptune')
    expect(position.clock).toBeGreaterThan(1)
    expect(resolvePhysicalSpawns(result.map_key, result.author_team, position)).toBeNull()
  })
  it('resolves real pinned Random fixture against independent scene/cardinal expected', async () => {
    const bytes = readFileSync(fileURLToPath(new URL('../../../../common/fixtures/replays/random-battle-example.wotbreplay', import.meta.url)))
    const agent = await wasm()
    const result = JSON.parse(agent.parseResult(bytes))
    const position = JSON.parse(agent.parseAuthorInitialPosition!(bytes)) as AgentAuthorInitialPosition
    expect(result.map_key).toBe('rift')
    expect(result.author_team).toBe(2)
    // Scene Spawn2-8 is [141.0831,210.5851,50.4194], in northern grid row.
    expect(Math.hypot(position.position[0] - 141.0831, position.position[2] - 210.5851)).toBeCloseTo(0.936592107, 6)
    expect(resolvePhysicalSpawns(result.map_key, result.author_team, position)).toEqual({ team1: 'SOUTH', team2: 'NORTH' })
    expect(resolvePhysicalSpawns('malinovka', result.author_team, position)).toBeNull()
  })
})
