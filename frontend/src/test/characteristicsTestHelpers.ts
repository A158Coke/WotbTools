import CONSUMABLES from '../replay-local/compute/__fixtures__/research/consumables.json'
import PROVISIONS from '../replay-local/compute/__fixtures__/research/provisions.json'
import DEVICES from '../replay-local/compute/__fixtures__/research/devices.json'
import CAMOUFLAGE from '../replay-local/compute/__fixtures__/research/camouflage.json'
import SKILLS from '../replay-local/compute/__fixtures__/research/skills.json'
import USSRS from '../replay-local/compute/__fixtures__/modules/ussr.json'
import EUROPEANS from '../replay-local/compute/__fixtures__/modules/european.json'
import GERMANY from '../replay-local/compute/__fixtures__/modules/germany.json'
import type { ComputeInput } from '../replay-local/compute/characteristics'

export const T34 = (USSRS as any).tanks['T-34']
export const IS4 = (USSRS as any).tanks['IS-4']
export const MINOTAURO = (EUROPEANS as any).tanks['It21_Controcarro3_Minotauro']
export const JAGDTIGER = (GERMANY as any).tanks['JagdTiger']
const S54 = { damage: 160, penetration: 125, type: 'ap' }
export const NET_SCRIPT = (DEVICES as any).devices.find((device: any) => device.stem === 'camouflageNet').script.params
export const PAINT = (CAMOUFLAGE as any).categories[(CAMOUFLAGE as any).defaultCategory]
const L11 = { damage: 140, penetration: 85, type: 'ap' }
export { L11, S54 }

function scriptMap(items: any[], stems: string[]) {
  const want = new Set(stems)
  const out: Record<string, any> = {}
  for (const item of items) if (want.has(item.stem) && item.script) out[item.stem] = item.script
  return out
}

export function setup(overrides: Partial<ComputeInput>): ComputeInput {
  const input: ComputeInput = {
    modules: T34,
    turretIdx: 1,
    gunIdx: 3,
    engineIdx: 1,
    trackIdx: 1,
    standardShell: S54,
    isBurstGun: false,
    deviceIds: [],
    provisionStems: [],
    provisionScripts: {},
    consumableScripts: {},
    consumableStems: [],
    skillLevels: {},
    skillEffects: (SKILLS as any).items,
    camouflage: false,
    camouflageNet: NET_SCRIPT,
    paintInvisibility: PAINT,
    vehicleClass: 'mediumTank',
    crewRoles: T34.crewRoles,
    ...overrides,
  }
  if (!overrides.provisionScripts) input.provisionScripts = scriptMap(PROVISIONS.items, input.provisionStems)
  if (!overrides.consumableScripts) input.consumableScripts = scriptMap(CONSUMABLES.items, input.consumableStems)
  return input
}
