import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import DEVICES from '../replay-local/compute/__fixtures__/research/devices.json'
import CONSUMABLES from '../replay-local/compute/__fixtures__/research/consumables.json'
import PROVISIONS from '../replay-local/compute/__fixtures__/research/provisions.json'
import SKILLS from '../replay-local/compute/__fixtures__/research/skills.json'
import CAMOUFLAGE from '../replay-local/compute/__fixtures__/research/camouflage.json'
import FORMAT from '../replay-local/compute/__fixtures__/research/params/format.json'
import UPGRADE_TANKS from '../replay-local/compute/__fixtures__/upgrades/tanks.json'

const CATALOG = {
  devices: DEVICES.devices,
  devicePresets: DEVICES.presets,
  consumables: CONSUMABLES.items,
  provisions: PROVISIONS.items,
  paramsFormat: FORMAT.params,
  camouflage: { defaultCategory: CAMOUFLAGE.defaultCategory, categories: CAMOUFLAGE.categories },
  skills: SKILLS.items,
  crewSkillClasses: SKILLS.classes,
}

function moduleFixture() {
  const gunStats = reload => ({
    reloadTime: reload, aimingTime: 2.5, shotDispersionRadius: 0.4, weight: 2500,
    invisibilityFactorAtShot: 0.3, pitchLimits: { min: -6, max: 15 },
    dispersionFactors: { turretRotation: 0.1, afterShot: 3.5, whileGunDamaged: 2 },
  })
  return {
    tankId: 999, name: 'IS-7', tier: 10, tags: [],
    consumableSlots: 2, provisionSlots: 1,
    optDevicePreset: 'defaultPreset',
    speedLimits: { forward: 50, backward: 15 },
    invisibility: { still: 0.1, moving: 0.08, firePenalty: 0.4 },
    hull: { hp: 2000, weight: 50000 },
    turretOrigin: [0, 0.3, 1.5],
    bbox: {
      chassis: { min: [-1.75, -3.6, 0], max: [1.75, 3.6, 1.2] },
      hull: { min: [-1.7, -3.5, 0.4], max: [1.7, 3.5, 1.7] },
    },
    crewRoles: ['commander', 'driver', 'gunner', 'loader'],
    chassis: [
      { stem: 'track0', localId: 0, name_en: 'Track 0', stats: { rotationSpeed: 30, terrainResistance: [1.2, 1.4, 2], maxLoad: 55000, weight: 10000, hysteresisHealth: 24, healthRegenPerSec: 3.5, hullPosition: [0, 0, 0], dispersionFactors: { vehicleMovement: 0.19, vehicleRotation: 0.19 } } },
      { stem: 'track1', localId: 1, name_en: 'Track 1', stats: { rotationSpeed: 35, terrainResistance: [1, 1.2, 1.8], maxLoad: 60000, weight: 11000, hysteresisHealth: 24, healthRegenPerSec: 3.5, hullPosition: [0, 0, 0], dispersionFactors: { vehicleMovement: 0.17, vehicleRotation: 0.17 } } },
    ],
    engines: [
      { stem: 'eng0', localId: 0, name_en: 'Engine 0', stats: { power: 1000, fireStartingChance: 0.15, weight: 1000 } },
      { stem: 'eng1', localId: 1, name_en: 'Engine 1', stats: { power: 1200, fireStartingChance: 0.15, weight: 1200 } },
    ],
    turrets: [
      {
        stem: 't0', localId: 0, name_en: 'Turret 0',
        stats: { rotationSpeed: 25, circularVisionRadius: 400, maxHealth: 400, weight: 3000, bbox: { min: [-1.4, -2, 0], max: [1.4, 2, 1] } },
        guns: [{ stem: 'g0', localId: 0, name_en: 'Gun 0', stats: gunStats(12) }],
      },
      {
        stem: 't1', localId: 1, name_en: 'Turret 1',
        stats: { rotationSpeed: 30, circularVisionRadius: 450, maxHealth: 500, weight: 3500, bbox: { min: [-1.4, -2, 0], max: [1.4, 2, 1] } },
        guns: [
          { stem: 'g0', localId: 0, name_en: 'Gun 0', stats: gunStats(12) },
          { stem: 'g1', localId: 1, name_en: 'Gun 1', stats: gunStats(10) },
        ],
      },
    ],
  }
}

function configFixture() {
  const shell = { type: 'ap', damage: 490, penetration: 250, penetration_far: 230, velocity: 900, normalization: 5, ricochet: 70 }
  const he = { type: 'he', damage: 600, penetration: 90, penetration_far: 90, velocity: 700, normalization: 0, ricochet: 70 }
  return [
    { label: 'Stock', turret_local: 0, gun_local: 0, shells: [shell, he] },
    { label: 'Mid', turret_local: 1, gun_local: 0, shells: [shell, he] },
    {
      label: 'Top',
      turret_local: 1,
      gun_local: 1,
      shells: [shell, he],
      pitch_limits: { max: 6, min: -18, back: { max: 3, min: -18, range: 30 } },
    },
  ]
}

function makeCache(count = 120) {
  const cache = {}
  for (let i = 1; i <= count; i += 1) {
    cache[i] = {
      name: `Tank ${String(i).padStart(3, '0')}`,
      tier: (i % 10) + 1,
      nation: i % 2 ? 'ussr' : 'germany',
      type: i % 3 ? 'heavyTank' : 'mediumTank',
      hp: 1000 + i,
      shells: [{ penetration: 100 + i }],
    }
  }
  cache[999] = { name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400, shells: [{ penetration: 300 }] }
  return cache
}

function createMountAt(Component) {
  return async (query = {}) => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push({ path: '/', query: { view: 'agent-tankopedia', ...query } })
    const wrapper = mount(Component, {
      global: { plugins: [router], provide: { [DIALOG_INLINE_KEY]: true }, mocks: { $t: key => key } },
    })
    await flushPromises()
    return { wrapper, router }
  }
}

export { CATALOG, UPGRADE_TANKS, configFixture, createMountAt, makeCache, moduleFixture }
