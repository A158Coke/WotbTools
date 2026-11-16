import { describe, expect, it } from 'vitest'
import { compareDatasetVersionDesc, datasetVersionKey, orderDatasetsForDisplay } from './datasetOrder'

describe('datasetVersionKey', () => {
  it('数值段解析：正式 / SmartDLC 槽位 / 四段构建号 / 发布修订', () => {
    expect(datasetVersionKey('11.21.0')).toEqual([11, 21, 0, 0, 0, 0])
    expect(datasetVersionKey('11.21.0_1')).toEqual([11, 21, 0, 0, 1, 0])
    expect(datasetVersionKey('11.4.0.138')).toEqual([11, 4, 0, 138, 0, 0])
    expect(datasetVersionKey('11.4.0.138-r5')).toEqual([11, 4, 0, 138, 0, 5])
    expect(datasetVersionKey('supertest')).toEqual([])
    expect(datasetVersionKey('')).toEqual([])
  })
  it('槽位段大于无槽位；逐段数值比较（11.21 > 11.4）', () => {
    expect(compareDatasetVersionDesc({ id: '11.21.0_1' }, { id: '11.21.0' })).toBeLessThan(0)
    expect(compareDatasetVersionDesc({ id: '11.21.0' }, { id: '11.4.0.130' })).toBeLessThan(0)
    expect(compareDatasetVersionDesc({ id: '11.4.0.138' }, { id: '11.4.0.130' })).toBeLessThan(0)
  })
  it('发布修订段：同构建号 -rN 大于无修订，且不改变构建号比较', () => {
    expect(compareDatasetVersionDesc({ id: '11.4.0.138-r5' }, { id: '11.4.0.138' })).toBeLessThan(0)
    expect(compareDatasetVersionDesc({ id: '11.4.0.138-r5' }, { id: '11.4.0.130' })).toBeLessThan(0)
  })
})

describe('orderDatasetsForDisplay：最新超测 → 最新现行版本 → 其余版本递降', () => {
  const entries = [
    { id: '11.4.0.130', variant: 't11p2' },
    { id: '11.21.0' },
    { id: '11.4.0.138-r5', variant: 't11r3' },
    { id: '11.21.0_1' },
  ]

  it('生产目录现状：11.4.0.138-r5 → 11.21.0_1 → 11.21.0 → 11.4.0.130', () => {
    expect(orderDatasetsForDisplay(entries).map(e => e.id)).toEqual([
      '11.4.0.138-r5', '11.21.0_1', '11.21.0', '11.4.0.130',
    ])
  })

  it('输入顺序无关；不修改入参', () => {
    const shuffled = [entries[2], entries[0], entries[3], entries[1]]
    const snapshot = JSON.stringify(shuffled)
    expect(orderDatasetsForDisplay(shuffled).map(e => e.id)).toEqual([
      '11.4.0.138-r5', '11.21.0_1', '11.21.0', '11.4.0.130',
    ])
    expect(JSON.stringify(shuffled)).toBe(snapshot)
  })

  it('无超测：最新现行版本在最上（SmartDLC 槽位按版本号高于基础版本）', () => {
    expect(orderDatasetsForDisplay([
      { id: '11.21.0_1' }, { id: '11.21.0' },
    ]).map(e => e.id)).toEqual(['11.21.0_1', '11.21.0'])
  })

  it('只有超测：超测版本递降', () => {
    expect(orderDatasetsForDisplay([
      { id: '11.4.0.130', variant: 't11p2' }, { id: '11.4.0.138-r5', variant: 't11r3' },
    ]).map(e => e.id)).toEqual(['11.4.0.138-r5', '11.4.0.130'])
  })
})
