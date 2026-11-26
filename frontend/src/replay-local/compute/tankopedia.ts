
export interface TankInfo {
  name: string
  tier: number | string
  type: string
  nation: string
  alphaDamage: number | null
  maxHp: number | null
  extraInfo: string
}

export interface Tankopedia {
  info(tankId: number): TankInfo
  readonly size: number
}

type JsonRecord = Record<string, unknown>

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function hasNonNull(node: JsonRecord, key: string): boolean {
  return node[key] !== undefined && node[key] !== null
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v : String(v)
}

const INT_MIN = -2147483648
const INT_MAX = 2147483647

function firstInt(node: JsonRecord, key: string): number | null {
  const v = node[key]
  if (typeof v === 'number' && Number.isFinite(v) && v >= INT_MIN && v <= INT_MAX) {
    return Math.trunc(v)
  }
  return null
}

function asInt(v: unknown): number {
  if (typeof v === 'number') return Math.trunc(v)
  if (typeof v === 'string') {
    const n = Number.parseInt(v.trim(), 10)
    return Number.isNaN(n) ? 0 : n
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  return 0
}

export function createTankopedia(tierDocuments: readonly unknown[]): Tankopedia {
  const vehicles = new Map<number, JsonRecord>()
  for (const doc of tierDocuments) {
    if (!isRecord(doc) || !Array.isArray(doc.vehicles)) continue
    for (const vehicle of doc.vehicles) {
      if (isRecord(vehicle) && typeof vehicle.id === 'number' && Number.isInteger(vehicle.id)) {
        vehicles.set(vehicle.id, vehicle)
      }
    }
  }
  return {
    size: vehicles.size,
    info(tankId: number): TankInfo {
      const vehicle = vehicles.get(tankId)
      if (vehicle === undefined) {
        return { name: `#${tankId}`, tier: '', type: '', nation: '', alphaDamage: null, maxHp: null, extraInfo: '' }
      }
      return {
        name: hasNonNull(vehicle, 'name') ? asText(vehicle.name) : `#${tankId}`,
        tier: hasNonNull(vehicle, 'tier') ? asInt(vehicle.tier) : '',
        type: hasNonNull(vehicle, 'class') ? asText(vehicle.class) : '',
        nation: hasNonNull(vehicle, 'nation') ? asText(vehicle.nation) : '',
        alphaDamage: firstInt(vehicle, 'alphaDamage'),
        maxHp: firstInt(vehicle, 'hp'),
        extraInfo: hasNonNull(vehicle, 'extraInfo') ? asText(vehicle.extraInfo) : '',
      }
    },
  }
}

export async function loadTankopedia(): Promise<Tankopedia> {
  const docs = await Promise.all([
    import('../../../../common/tankopedia-tier1.json'),
    import('../../../../common/tankopedia-tier2.json'),
    import('../../../../common/tankopedia-tier3.json'),
    import('../../../../common/tankopedia-tier4.json'),
    import('../../../../common/tankopedia-tier5.json'),
    import('../../../../common/tankopedia-tier6.json'),
    import('../../../../common/tankopedia-tier7.json'),
    import('../../../../common/tankopedia-tier8.json'),
    import('../../../../common/tankopedia-tier9.json'),
    import('../../../../common/tankopedia-tier10.json'),
  ])
  return createTankopedia(docs.map((m) => m.default))
}

export function tankMaxHpValue(tankopedia: Tankopedia, tankId: number): number | null {
  if (tankId <= 0) return null
  const hp = tankopedia.info(tankId).maxHp
  return hp !== null && hp > 0 ? hp : null
}
