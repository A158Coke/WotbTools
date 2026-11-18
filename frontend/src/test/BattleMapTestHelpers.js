import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import BattleMap from '../components/BattleMap.vue'

/** Create isolated BattleMap fixtures for one test suite. */
export function createBattleMapTestFixtures() {
  const markerStub = defineComponent({
    props: ['marker', 'selected', 'label', 'hp', 'hpVisible', 't', 'hpGhost', 'hpFlash', 'hpNoTransition'],
    emits: ['select'],
    setup(props, { emit }) {
      return () => h('button', {
        'data-test': `marker-${props.marker.vehicle.accountId}`,
        'data-selected': String(props.selected),
        style: props.marker?.markerStyle || {},
        onClick: event => emit('select', event),
      })
    },
  })

  const baseProps = () => ({
    image: { src: '/map.png' },
    mapView: {
      W: 100,
      H: 100,
      toX: value => value,
      toY: value => 100 - value,
      fromX: value => value,
      fromY: value => 100 - value,
    },
    pbOverview: {
      playableBounds: { xMin: -20, xMax: 20, yMin: -20, yMax: 20 },
      spawnPoints: [{ name: 'spawn', x: 4, y: 5, team: 1 }],
    },
    friendlyTeam: 1,
    bases: [
      { baseId: 'A', x: -10, y: 10, radius: 15, status: 'friendly_controlled' },
      { baseId: 'B', x: 10, y: -10, radius: 15, status: 'capturing' },
    ],
    visibleTracers: [{ timeSec: 2, hasLine: true, x1: 1, y1: 2, x2: 5, y2: 6, attackerAccountId: 1, opacity: 1, flashProgress: 1, flashOpacity: 0 }],
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

  const mountMap = (overrides = {}) => mount(BattleMap, {
    props: { ...baseProps(), ...overrides },
    global: { stubs: { VehicleMarker: markerStub }, mocks: { $t: key => key } },
  })

  return { baseProps, mountMap }
}
