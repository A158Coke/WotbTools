/**
 * Tier X 专属车型 — 覆盖率门禁。
 *
 * 强制契约：
 * - Tankopedia 中所有 Tier X 必须 100% 有 baseModelKey mapping；
 * - mapping 不得指向不存在的 modelKey、不得含 Tankopedia 之外的 tankId；
 * - mapping 期望的每个 modelKey 都必须有完整 source asset（hull + turret 按 kind）；
 * - 未来新增 Tier X → 缺失 mapping → CI FAIL（禁止 silent fallback）。
 */
import { describe, expect, it } from 'vitest'
import tankopedia from '../../../common/tankopedia-tier10.json'
import { MODEL_DEFINITIONS, TANK_ID_TO_MODEL } from './mapping.js'
import {
  listModelKeys,
  readModelDir,
  validateCoverage,
  validateModelEntry,
} from './validate.js'

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
      assetKeys: new Set(listModelKeys()),
    })
    expect(errors).toEqual([])
    expect(stats.tankCount).toBe(stats.mappedCount)
    expect(stats.mappedCount).toBe(tankopedia.vehicles.length)
  })

  it('mapping 指向缺失 source asset 目录时必须 FAIL（不能只遍历现有目录）', () => {
    const { errors } = validateCoverage({
      tankopedia: { vehicles: [{ id: 1, name: 'Synthetic Tier X' }] },
      tankIdToModel: { '1': 'missing-model' },
      modelDefinitions: { 'missing-model': { kind: 'turretless', tankIds: [1] } },
      assetKeys: new Set(),
    })
    expect(errors).toContain('mapping modelKey missing-model（tankId=1）缺少 source asset 目录')
  })

  it('Type 5 Heavy 与 Type 5 H Zetsu 必须使用不同的 dedicated source asset', () => {
    expect(TANK_ID_TO_MODEL['8033']).toBe('type-5-heavy')
    expect(TANK_ID_TO_MODEL['9057']).toBe('type-5-h-zetsu')
    const oldMeta = JSON.parse(readModelDir('type-5-heavy').metadata)
    const zetsuMeta = JSON.parse(readModelDir('type-5-h-zetsu').metadata)
    expect(oldMeta.source.tankId).toBe(8033)
    expect(zetsuMeta.source.tankId).toBe(9057)
    expect(oldMeta.modelKey).not.toBe(zetsuMeta.modelKey)
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

describe('assets/ 目录完整性（映射期望集合 + sample 契约）', () => {
  it('每个映射 modelKey 通过 validateModelEntry（含 metadata.json 契约）', () => {
    const modelKeys = [...new Set(Object.values(TANK_ID_TO_MODEL))]
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

  it('额外已就位目录（有 metadata.json）不得缺 hull/turret webp（半成品 FAIL）', () => {
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
