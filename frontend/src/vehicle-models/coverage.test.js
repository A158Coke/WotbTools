/**
 * Tier X 专属车型 — 覆盖率门禁（计划 §10）。
 *
 * 强制契约：
 * - Tankopedia 中所有 Tier X 必须 100% 有 baseModelKey mapping；
 * - mapping 不得指向不存在的 modelKey、不得含 Tankopedia 之外的 tankId；
 * - assets/ 下每个已就位目录（含 metadata.json）必须资产完整（hull + turret 按 kind）；
 * - 未来新增 Tier X → 缺失 mapping → CI FAIL（禁止 silent fallback）。
 */
import {describe, expect, it} from 'vitest'
import tankopedia from '../../../common/tankopedia-tier10.json'
import {MODEL_DEFINITIONS, TANK_ID_TO_MODEL} from './mapping.js'
import {listModelKeys, readModelDir, validateCoverage, validateModelEntry,} from './validate.js'

describe('Tier X coverage（common/tankopedia-tier10.json vs mapping）', () => {
  it('Tankopedia 数据自洽（meta.count === vehicles.length）', () => {
    expect(tankopedia.meta.tier).toBe(10)
    expect(tankopedia.meta.count).toBe(tankopedia.vehicles.length)
    expect(tankopedia.vehicles.length).toBeGreaterThan(0)
  })

  it('所有 Tier X 100% 有 mapping，mapping 无孤儿/未知引用', () => {
    const { errors, stats } = validateCoverage({
      tankopedia,
      tankIdToModel: TANK_ID_TO_MODEL,
      modelDefinitions: MODEL_DEFINITIONS,
    })
    expect(errors).toEqual([])
    expect(stats.tankCount).toBe(stats.mappedCount)
    expect(stats.mappedCount).toBe(tankopedia.vehicles.length)
  })

  it('mapping 的 kind 声明与 class 常识不冲突（Tank destroyer 分组覆盖检查）', () => {
    // 防手误：所有 turretless 车型必须在 TD 中（tankopedia 无 turret 字段，
    // 该检查只验证 turretless 声明集中在 TD 类，作为最低防线）。
    const tdIds = new Set(
      tankopedia.vehicles.filter((v) => v.class === 'Tank destroyer').map((v) => String(v.id)),
    )
    for (const [modelKey, def] of Object.entries(MODEL_DEFINITIONS)) {
      if (def.kind === 'turretless') {
        for (const id of def.tankIds) {
          expect(tdIds.has(String(id)), `turretless ${modelKey} (${id}) 不在 Tank destroyer 类`).toBe(true)
        }
      }
    }
  })
})

describe('assets/ 目录完整性（当前仅 sample 契约样例）', () => {
  it('每个已就位目录通过 validateModelEntry（含 metadata.json 契约）', () => {
    const modelKeys = listModelKeys()
    expect(modelKeys.length).toBeGreaterThan(0)
    for (const modelKey of modelKeys) {
      const def = MODEL_DEFINITIONS[modelKey]
      const files = readModelDir(modelKey)
      const errors = validateModelEntry({
        modelKey,
        kind: def ? def.kind : null,
        files,
      })
      // kind=null（非映射目录如 sample）时只校验契约本身，不做 mapping 一致性
      expect(errors, `${modelKey} 校验失败`).toEqual([])
    }
  })

  it('已就位目录（有 metadata.json）不得缺 hull/turret webp（半成品 FAIL）', () => {
    for (const modelKey of listModelKeys()) {
      const files = readModelDir(modelKey)
      if (!files.metadata) continue
      expect(files.hull, `${modelKey} 有 metadata 但缺 hull.webp`).toBeTruthy()
      const def = MODEL_DEFINITIONS[modelKey]
      if (def?.kind === 'turreted') {
        expect(files.turret, `${modelKey} turreted 缺 turret.webp`).toBeTruthy()
      } else if (def?.kind === 'turretless') {
        expect(files.turret, `${modelKey} turretless 禁止 turret.webp`).toBeFalsy()
      }
    }
  })
})
