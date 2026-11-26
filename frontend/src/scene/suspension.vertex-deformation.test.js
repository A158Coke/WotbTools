import { describe, it, expect } from 'vitest'
import { vertexChainParams, applyChainToVertices, chainChanged, chainDrift, writeUvOffsetV } from './suspension.ts'



describe('花纹偏移写 V：取模只作用于偏移（保护跨 wrap 图元的插值）', () => {
  it('跨多个 wrap 的四边形：两端 ΔV 保持不变（逐顶点取模会把 2.85 折成 0.15 ⇒ 拉长 18×）', () => {
    const base = new Float32Array([0.3, 1.548, 0.9, 4.394]);
    const uv = new Float32Array(base.length);
    writeUvOffsetV(uv, base, 0.3);
    expect(uv[1] - uv[3]).toBeCloseTo(1.548 - 4.394, 5);
    const bad = [1.548 + 0.3, 4.394 + 0.3].map((v) => v - Math.floor(v));
    expect(Math.abs(bad[0] - bad[1])).toBeLessThan(0.2);
  })

  it('整带同相：所有顶点按同一相位平移；偏移取整不改变观感（REPEAT 等价）', () => {
    const base = new Float32Array([0.1, 2.7, 0.2, 9.05, 0.3, 4.15]);
    const a = base.slice(); const b = base.slice();
    writeUvOffsetV(a, base, 0.25);
    writeUvOffsetV(b, base, 3.25);
    for (let i = 0; i < base.length / 2; i++) {
      expect(a[i * 2 + 1]).toBeCloseTo(base[i * 2 + 1] + 0.25, 5);
      expect(b[i * 2 + 1]).toBeCloseTo(a[i * 2 + 1], 5);
      expect(a[i * 2]).toBe(base[i * 2]);
    }
    const c = base.slice();
    writeUvOffsetV(c, base, -0.25);
    expect(c[1]).toBeCloseTo(base[1] + 0.75, 5);
  })
})



describe('顶点形变：映射 + 位移方向', () => {
  it('顶点→段落映射取最近段，位移在段内线性插值', () => {
    const rest = [[0, 0], [2, 0], [4, 0]]
    const pos = new Float32Array([
      0, 0, 1,
      0, 1, 1,
      0, 2.5, 1,   // 纵向 2.5 → 段 1 t=0.25
    ])
    const params = vertexChainParams(pos, rest)
    expect(Array.from(params.seg)).toEqual([0, 0, 1])
    expect(params.t[0]).toBeCloseTo(0, 6)
    expect(params.t[1]).toBeCloseTo(0.5, 6)
    expect(params.t[2]).toBeCloseTo(0.25, 6)
    const out = new Float32Array(pos.length)
    const chainZ = [0.5, 0.5, 0.5]
    const restZ = [0, 0, 0]
    const maxAbs = applyChainToVertices(out, pos, params, chainZ, restZ, [0, 0, 1])
    expect(maxAbs).toBeCloseTo(0.5, 6)
    expect(out[0]).toBeCloseTo(0, 6)
    expect(out[1]).toBeCloseTo(0, 6)
    expect(out[2]).toBeCloseTo(1.5, 6)
  })

  it('网格带旋转时沿"局部等效轴"位移（模型 +z = 局部 +y 的四元数）', () => {
    const rest = [[0, 0], [1, 0]]
    const pos = new Float32Array([0, 0, 0])
    const params = vertexChainParams(pos, rest)
    const out = new Float32Array(3)
    applyChainToVertices(out, pos, params, [0.25, 0.25], [0, 0], [0, 1, 0])
    expect(out[1]).toBeCloseTo(0.25, 6)
    expect(out[2]).toBeCloseTo(0, 6)
  })
})



describe('chainChanged（履带形变 = 链的纯函数；下发判定按下发链比较）', () => {
  it('链相同 ⇒ false（顶点逐点相同）；任一点不同 / 长度或空值 ⇒ true（fail-safe）', () => {
    const a = new Float64Array([1, 2, 3, 4])
    const b = Float64Array.from(a)
    expect(chainChanged(a, b)).toBe(false)
    b[2] = 3.0000001
    expect(chainChanged(a, b)).toBe(true)
    expect(chainChanged(null, a)).toBe(true)
    expect(chainChanged(a, null)).toBe(true)
    expect(chainChanged(a, new Float64Array([1, 2, 3]))).toBe(true)
  })
})



describe('chainDrift（法线闸门：与上次重算法线时的链逐点比较）', () => {
  it('最大幅度与均值相同、形变位置不同 ⇒ 也必须检出（旧口径漏报的形态）', () => {
    const a = new Float64Array([0.1, 0, 0, 0])
    const b = new Float64Array([0, 0.1, 0, 0])
    const max = (v) => Math.max(...v)
    const mean = (v) => v.reduce((s, x) => s + Math.abs(x), 0) / v.length
    expect(max(a)).toBeCloseTo(max(b), 12)
    expect(mean(a)).toBeCloseTo(mean(b), 12)
    expect(chainDrift(a, b)).toBeCloseTo(0.1, 12)
    expect(chainDrift(a, Float64Array.from(a))).toBe(0)
    expect(chainDrift(null, a)).toBe(Infinity)
    expect(chainDrift(a, new Float64Array([0.1]))).toBe(Infinity)
  })
})
