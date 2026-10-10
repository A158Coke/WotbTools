import { describe, it, expect } from 'vitest'
import { applyTerrainCover } from './terrainCover.js'

// 地形让位掩码消费端契约。后果边界：掩码变"抬高地形"或"影响查询高度"都会破坏行为
// （前者会在地形低处开槽，后者会让拾取/贴地/贴花错位）。
describe('地形让位掩码（渲染用高度场）', () => {
  const k = 100 / 65535, zmin = 0
  it('0 = 无覆盖（哨兵）：全 0 掩码 ⇒ 原场不变、changed = 0', () => {
    const f = new Float32Array([20, 21, 22])
    const r = applyTerrainCover(f, new Uint16Array([0, 0, 0]), k, zmin)
    expect(r.changed).toBe(0)
    expect(Array.from(r.field)).toEqual([20, 21, 22])
  })

  it('只压不抬：天花板高于原地形处不生效', () => {
    const f = new Float32Array([20, 21])
    const hi = Math.round(50 / k) + 1        // 天花板 50 m（远高于地形）
    const lo = Math.round(20.5 / k) + 1      // 天花板 20.5 m
    const r = applyTerrainCover(f, new Uint16Array([hi, lo]), k, zmin)
    expect(r.field[0]).toBeCloseTo(20, 6)    // 不抬
    expect(r.field[1]).toBeCloseTo(20.5, 2)  // 压低到天花板（u16 量化 ≈1.5 mm）
    expect(r.changed).toBe(1)
  })

  it('不改入参（返回新数组）且 zmin 偏移参与解码', () => {
    const f = new Float32Array([30, 30])
    const v = Math.round((25 - 10) / k) + 1  // zmin=10 下天花板 25 m（低于地形 30 ⇒ 压低）
    const r = applyTerrainCover(f, new Uint16Array([0, v]), k, 10)
    expect(f[1]).toBe(30)                    // 入参未被写
    expect(r.field[0]).toBe(30)              // 无覆盖处不动
    expect(r.field[1]).toBeCloseTo(25, 2)
  })
})
