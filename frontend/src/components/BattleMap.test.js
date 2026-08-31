// @vitest-environment happy-dom

import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BattleMap from './BattleMap.vue'

const markerStub = defineComponent({
  props: ['marker', 'selected', 'label', 'hp', 'hpVisible', 't', 'hpGhost', 'hpFlash', 'hpNoTransition'],
  emits: ['select'],
  setup(props, { emit }) {
    return () => h('button', {
      'data-test': `marker-${props.marker.vehicle.accountId}`,
      'data-selected': String(props.selected),
      onClick: event => emit('select', event),
    })
  },
})

const mapView = {
  W: 100,
  H: 100,
  toX: value => value,
  toY: value => 100 - value,
}

const baseProps = () => ({
  image: { src: '/map.png' },
  mapView,
  pbOverview: {
    gridCells: [{ id: 'a', bounds: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 } }],
    spawnPoints: [{ name: 'spawn', x: 4, y: 5, team: 1 }],
  },
  friendlyTeam: 1,
  gridRegions: [['A', { xMin: 10, xMax: 20, yMin: 10, yMax: 20 }]],
  visibleTracers: [{ timeSec: 2, x1: 1, y1: 2, x2: 5, y2: 6, attackerAccountId: 1, opacity: 1, flashProgress: 1, flashOpacity: 0 }],
  tracerColor: () => '#fff',
  renderedAnnotations: [{ type: 'text', x: 30, y: 30, text: 'Callout', color: '#fff' }],
  annotVisible: true,
  vehicleStates: [
    { vehicle: { accountId: 1, team: 1 } },
    { vehicle: { accountId: 2, team: 2 } },
  ],
  selectedAccountId: 2,
  markerLabel: () => ({ showTank: true }),
  hpFor: () => null,
  hpPrefs: { showHp: true },
  translate: key => key,
  ghostFor: () => null,
  flashFor: () => false,
  floatTeamClass: team => `team-${team}`,
})

function mountMap(overrides = {}) {
  return mount(BattleMap, {
    props: { ...baseProps(), ...overrides },
    global: { stubs: { VehicleMarker: markerStub }, mocks: { $t: key => key } },
  })
}

describe('BattleMap', () => {
  it('renders map layers, annotations, and selected marker state', () => {
    const wrapper = mountMap()

    expect(wrapper.find('image').attributes('href')).toBe('/map.png')
    expect(wrapper.findAll('.pb-cell')).toHaveLength(1)
    expect(wrapper.findAll('.pb-region-line')).toHaveLength(1)
    expect(wrapper.findAll('.pb-spawn-friendly')).toHaveLength(1)
    expect(wrapper.findAll('.pb-tracer')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-annotations"]').text()).toContain('Callout')
    expect(wrapper.find('[data-test="marker-1"]').attributes('data-selected')).toBe('false')
    expect(wrapper.find('[data-test="marker-2"]').attributes('data-selected')).toBe('true')
  })

  it('forwards map gestures and marker selection to the orchestrator', async () => {
    const wrapper = mountMap()
    const viewport = wrapper.find('[data-test="pb-viewport"]')

    await viewport.trigger('pointerdown', { clientX: 1, clientY: 2 })
    await viewport.trigger('pointermove', { clientX: 3, clientY: 4 })
    await viewport.trigger('pointerup', { clientX: 3, clientY: 4 })
    await viewport.trigger('click')
    await wrapper.find('[data-test="marker-2"]').trigger('click')
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -1 })

    expect(wrapper.emitted('pointer-down')).toHaveLength(1)
    expect(wrapper.emitted('pointer-move')).toHaveLength(1)
    expect(wrapper.emitted('pointer-up')).toHaveLength(1)
    expect(wrapper.emitted('viewport-click')).toHaveLength(2)
    expect(wrapper.emitted('marker-select')[0][0].accountId).toBe(2)
    expect(wrapper.emitted('wheel')).toHaveLength(1)
  })
})
