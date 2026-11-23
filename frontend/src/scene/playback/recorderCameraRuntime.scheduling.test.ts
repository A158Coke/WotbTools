// Recorder 开/退镜的反射调度 guard（源码级）：Arcade ↔ Sniper 是离散图层切换，
// 不能等 HIGH 档 intervalFrames 的下一次到期帧，否则镜面保留上一帧开镜车体。
// 单一调用点也说明连续位姿变化仍只走 invalidate()，不绕过隔帧节流。
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new NodeURL(rel, import.meta.url), 'utf8')

describe('Recorder 开/退镜强制刷新水面反射（源码级）', () => {
  it('离散 scoped 图层切换分支内请求单帧反射刷新', () => {
    const src = read('./recorderCameraRuntime.ts')
    const start = src.indexOf('if (hiddenEid !== scopedHiddenEid)')
    const end = src.indexOf('} else if (scoped && v.glb')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const branch = src.slice(start, end)
    expect(branch).toMatch(/setScopedLayer\(v, scoped\);/)
    expect(branch).toMatch(/deps\.requestWaterReflectionRefresh\(\);/)
    // 连续位姿变化仍只 invalidate；全模块只允许这一个强制刷新点。
    expect(src.match(/requestWaterReflectionRefresh\(\)/g)).toHaveLength(1)
  })
})
