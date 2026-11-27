// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBattleMapTestFixtures } from '../test/BattleMapTestHelpers.js'
import { activeTerrainRelief } from '../utils/terrainReliefProjection.js'
import { createMapView } from '../utils/mapView.js'
import mountainSemantic from '../../../common/map-semantics/21_mountain_mnt.semantic.json'

const { mountMap } = createBattleMapTestFixtures()

afterEach(() => {
  activeTerrainRelief.value = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('BattleMap', () => {
  it('renders the HD raster as a standalone layer and keeps SVG overlay-only', () => {
    const wrapper = mountMap()

    expect(wrapper.find('[data-test="pb-basemap"]').element.tagName).toBe('IMG')
    expect(wrapper.find('[data-test="pb-basemap"]').attributes('src')).toBe('/map.png')
    expect(wrapper.find('.pb-svg image').exists()).toBe(false)
    expect(wrapper.find('.pb-basemap').element.parentElement).toBe(wrapper.find('.pb-svg').element.parentElement)
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('aspect-ratio: 100 / 100')
    expect(wrapper.findAll('.pb-base-circle')).toHaveLength(2)
    expect(wrapper.find('[data-test="pb-bases"]').text()).toContain('A')
    expect(wrapper.findAll('.pb-base-friendly_controlled')).toHaveLength(1)
    expect(wrapper.findAll('.pb-base-capturing')).toHaveLength(1)
    expect(wrapper.findAll('.pb-spawn-friendly')).toHaveLength(1)
    expect(wrapper.findAll('.pb-tracer')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-annotations"]').text()).toContain('Callout')
    expect(wrapper.find('[data-test="marker-1"]').attributes('data-selected')).toBe('false')
    expect(wrapper.find('[data-test="marker-2"]').attributes('data-selected')).toBe('true')
  })

  it('keeps the playable boundary off by default so replay 2D stays unchanged', () => {
    const wrapper = mountMap()
    expect(wrapper.find('[data-test="pb-playable-boundary"]').exists()).toBe(false)
  })

  it('projects opted-in semantic playable bounds to the SVG rect with screen-constant stroke', async () => {
    const bounds = mountainSemantic.playableBoundsMeters
    const { mapImages: canonicalMapImages } = await vi.importActual('../data/mapImages.js')
    const image = canonicalMapImages.mountain
    const overview = { mapCode: 'mountain', spawnPoints: [], playableBounds: bounds }
    const wrapper = mountMap({
      image,
      mapView: createMapView(image, overview),
      pbOverview: overview,
      showPlayableBoundary: true,
      viewScale: 2,
    })
    const rect = wrapper.get('[data-test="pb-playable-boundary"]')
    const cb = image.coordinateBounds
    const xMin = ((bounds.xMin - cb.xMin) / (cb.xMax - cb.xMin)) * image.width
    const xMax = ((bounds.xMax - cb.xMin) / (cb.xMax - cb.xMin)) * image.width
    const yTop = ((cb.yMax - bounds.yMax) / (cb.yMax - cb.yMin)) * image.height
    const yBottom = ((cb.yMax - bounds.yMin) / (cb.yMax - cb.yMin)) * image.height
    expect(Number(rect.attributes('x'))).toBeCloseTo(Math.min(xMin, xMax), 6)
    expect(Number(rect.attributes('y'))).toBeCloseTo(Math.min(yTop, yBottom), 6)
    expect(Number(rect.attributes('width'))).toBeCloseTo(Math.abs(xMax - xMin), 6)
    expect(Number(rect.attributes('height'))).toBeCloseTo(Math.abs(yBottom - yTop), 6)
    expect(rect.attributes('stroke-width')).toBe('1')
    expect(wrapper.get('[data-test="pb-bases"]').element.previousElementSibling).toBe(rect.element)
  })

  it('projects canonical spawn points and leaves them neutral without battle context', async () => {
    const { mapImages: canonicalMapImages } = await vi.importActual('../data/mapImages.js')
    const image = canonicalMapImages.mountain
    const spawnPoints = mountainSemantic.sceneEvidence.battlePoints
      .filter(point => point.type === 'spawnpoint')
      .map(point => ({ name: point.name, team: point.team, x: point.position[0], y: point.position[1] }))
    const overview = { mapCode: 'mountain', spawnPoints, playableBounds: mountainSemantic.playableBoundsMeters }
    const wrapper = mountMap({
      image,
      mapView: createMapView(image, overview),
      pbOverview: overview,
      friendlyTeam: null,
      bases: [],
      visibleTracers: [],
    })
    const circles = wrapper.findAll('.pb-spawns circle')
    expect(circles).toHaveLength(spawnPoints.length)
    expect(wrapper.findAll('.pb-spawn-neutral')).toHaveLength(spawnPoints.length)
    expect(wrapper.findAll('.pb-spawn-friendly')).toHaveLength(0)
    expect(wrapper.findAll('.pb-spawn-enemy')).toHaveLength(0)
    const cb = image.coordinateBounds
    const first = spawnPoints[0]
    expect(Number(circles[0].attributes('cx'))).toBeCloseTo(((first.x - cb.xMin) / (cb.xMax - cb.xMin)) * image.width, 6)
    expect(Number(circles[0].attributes('cy'))).toBeCloseTo(((cb.yMax - first.y) / (cb.yMax - cb.yMin)) * image.height, 6)
  })

  it('scene-team mode colors spawns by scene group team, unknown stays neutral (#835)', async () => {
    const { mapImages: canonicalMapImages } = await vi.importActual('../data/mapImages.js')
    const image = canonicalMapImages.mountain
    const spawnPoints = mountainSemantic.sceneEvidence.battlePoints
      .filter(point => point.type === 'spawnpoint')
      .map(point => ({ name: point.name, team: point.team, x: point.position[0], y: point.position[1] }))
    const overview = { mapCode: 'mountain', spawnPoints, playableBounds: mountainSemantic.playableBoundsMeters }
    const wrapper = mountMap({
      image,
      mapView: createMapView(image, overview),
      pbOverview: overview,
      friendlyTeam: null,
      spawnColorMode: 'scene-team',
      bases: [],
      visibleTracers: [],
    })
    const team1 = wrapper.findAll('.pb-spawn-team-1')
    const team2 = wrapper.findAll('.pb-spawn-team-2')
    const neutral = wrapper.findAll('.pb-spawn-neutral')
    expect(team1.length + team2.length + neutral.length).toBe(spawnPoints.length)
    expect(team1.length).toBe(spawnPoints.filter(p => p.team === 1).length)
    expect(team2.length).toBe(spawnPoints.filter(p => p.team === 2).length)
    expect(wrapper.findAll('.pb-spawn-enemy')).toHaveLength(0)
    expect(wrapper.findAll('.pb-spawn-friendly')).toHaveLength(0)
  })

  it('scene-team mode maps synthetic unknown team values (null/0/3) to neutral, never enemy', async () => {
    const spawnPoints = [
      { name: 'a', x: 1, y: 1, team: null },
      { name: 'b', x: 2, y: 2, team: 0 },
      { name: 'c', x: 3, y: 3, team: 3 },
    ]
    const wrapper = mountMap({
      pbOverview: { mapCode: 'mystery', spawnPoints },
      friendlyTeam: null,
      spawnColorMode: 'scene-team',
      bases: [],
      visibleTracers: [],
    })
    expect(wrapper.findAll('.pb-spawn-neutral')).toHaveLength(3)
    expect(wrapper.findAll('.pb-spawn-team-1')).toHaveLength(0)
    expect(wrapper.findAll('.pb-spawn-team-2')).toHaveLength(0)
    expect(wrapper.findAll('.pb-spawn-enemy')).toHaveLength(0)
  })

  it('scene-team mode ignores friendlyTeam (fixed group colors, not relative semantics)', async () => {
    const spawnPoints = [{ name: 'a', x: 1, y: 1, team: 1 }, { name: 'b', x: 2, y: 2, team: 2 }]
    const wrapper = mountMap({
      pbOverview: { mapCode: 'mystery', spawnPoints },
      friendlyTeam: 1,
      spawnColorMode: 'scene-team',
      bases: [],
      visibleTracers: [],
    })
    expect(wrapper.findAll('.pb-spawn-team-1')).toHaveLength(1)
    expect(wrapper.findAll('.pb-spawn-team-2')).toHaveLength(1)
    expect(wrapper.findAll('.pb-spawn-friendly')).toHaveLength(0)
    expect(wrapper.findAll('.pb-spawn-enemy')).toHaveLength(0)
  })

  it('replay mode default: friendlyTeam drives relative colors, scene-team classes unused', async () => {
    const spawnPoints = [{ name: 'a', x: 1, y: 1, team: 1 }, { name: 'b', x: 2, y: 2, team: 2 }]
    const friendly = mountMap({
      pbOverview: { mapCode: 'mystery', spawnPoints },
      friendlyTeam: 1,
      bases: [],
      visibleTracers: [],
    })
    expect(friendly.findAll('.pb-spawn-friendly')).toHaveLength(1)
    expect(friendly.findAll('.pb-spawn-enemy')).toHaveLength(1)
    expect(friendly.findAll('.pb-spawn-team-1')).toHaveLength(0)
    expect(friendly.findAll('.pb-spawn-team-2')).toHaveLength(0)
    const noContext = mountMap({
      pbOverview: { mapCode: 'mystery', spawnPoints },
      friendlyTeam: null,
      bases: [],
      visibleTracers: [],
    })
    expect(noContext.findAll('.pb-spawn-neutral')).toHaveLength(2)
    const circle = noContext.findAll('.pb-spawns circle')[0]
    expect(Number(circle.attributes('cx'))).toBeCloseTo(1, 6)
    expect(Number(circle.attributes('cy'))).toBeCloseTo(99, 6)
  })

  it('replay mode classifies spawns through the shared recorder-relative role', () => {
    const spawnClasses = (friendlyTeam, team) => {
      const wrapper = mountMap({
        pbOverview: { mapCode: 'mystery', spawnPoints: [{ name: 'a', x: 1, y: 1, team }] },
        friendlyTeam,
        bases: [],
        visibleTracers: [],
      })
      return {
        friendly: wrapper.findAll('.pb-spawn-friendly').length,
        enemy: wrapper.findAll('.pb-spawn-enemy').length,
        neutral: wrapper.findAll('.pb-spawn-neutral').length,
      }
    }

    expect(spawnClasses(1, 1)).toEqual({ friendly: 1, enemy: 0, neutral: 0 })
    expect(spawnClasses(2, 2)).toEqual({ friendly: 1, enemy: 0, neutral: 0 })
    expect(spawnClasses(2, 1)).toEqual({ friendly: 0, enemy: 1, neutral: 0 })
    for (const friendlyTeam of [0, 3]) {
      expect(spawnClasses(friendlyTeam, 1)).toEqual({ friendly: 0, enemy: 0, neutral: 1 })
      expect(spawnClasses(friendlyTeam, 2)).toEqual({ friendly: 0, enemy: 0, neutral: 1 })
    }
    for (const team of [0, 3, null, undefined]) {
      expect(spawnClasses(1, team)).toEqual({ friendly: 0, enemy: 0, neutral: 1 })
    }
  })

  it('fails closed when the opted-in boundary has no canonical bounds', () => {
    const wrapper = mountMap({
      showPlayableBoundary: true,
      pbOverview: { mapCode: 'mystery', spawnPoints: [] },
    })
    expect(wrapper.find('[data-test="pb-playable-boundary"]').exists()).toBe(false)
  })

  it('renders arrows with a butt cap so the round shaft cannot bulge past the head tip', () => {
    const wrapper = mountMap({
      renderedAnnotations: [{
        type: 'arrow', color: '#fff', width: 3, widthSvg: 3,
        x1: 0, y1: 0, x2: 10, y2: 10, head: '10,10 0,0 0,0',
      }],
    })
    const line = wrapper.find('[data-annotation-type="arrow"] line')
    expect(line.exists()).toBe(true)
    expect(line.attributes('stroke-linecap')).toBe('butt')
  })




})
