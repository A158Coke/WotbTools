/**
 * 车辆库（Java `com.wotb.core.ref.Tankopedia`）：tank_id → 名称/等级/车种/国家/炮伤/血量。
 *
 * 数据源与 Java classpath 资源同一份：仓库根 `common/tankopedia-tier{7,8,9,10}.json`
 * （Java 由 wotb-core/pom.xml 复制进 classpath）。按 tier7→tier10 顺序装载，重复 id 后者覆盖。
 */

/** 单辆车信息（Java `TankInfo`）。 */
export interface TankInfo {
  name: string
  /** Java `Object`：Integer 等级或空串（未知车辆）。 */
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

/** Jackson `hasNonNull(key)`。 */
function hasNonNull(node: JsonRecord, key: string): boolean {
  return node[key] !== undefined && node[key] !== null
}

/** Jackson `asText()`：文本原样，数字/布尔转字符串。 */
function asText(v: unknown): string {
  return typeof v === 'string' ? v : String(v)
}

const INT_MIN = -2147483648
const INT_MAX = 2147483647

/** Jackson `canConvertToInt() ? asInt() : null`（数值且落在 int 范围，截断取整）。 */
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

/** 由 tier 文件 JSON（`{vehicles: [...]}`）构建车辆库；缺失/损坏的文件忽略（同 Java 降级）。 */
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

/** 装载仓库内置车辆库（动态 import，独立 chunk，不进主 bundle）。 */
export async function loadTankopedia(): Promise<Tankopedia> {
  const docs = await Promise.all([
    import('../../../../common/tankopedia-tier7.json'),
    import('../../../../common/tankopedia-tier8.json'),
    import('../../../../common/tankopedia-tier9.json'),
    import('../../../../common/tankopedia-tier10.json'),
  ])
  return createTankopedia(docs.map((m) => m.default))
}

/** tankopedia base HP（Java `ReplayDisplayNames.tankMaxHpValue`）：tankId<=0 / 缺失 / <=0 → null。 */
export function tankMaxHpValue(tankopedia: Tankopedia, tankId: number): number | null {
  if (tankId <= 0) return null
  const hp = tankopedia.info(tankId).maxHp
  return hp !== null && hp > 0 ? hp : null
}
