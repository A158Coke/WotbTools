// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { occlusionCells } from './playbackScene.js'

describe('occlusionCells（标签遮挡候选格：线段经过的 16m 格）', () => {
  it('同一格内的短线段 → 单格；跨格 → 首尾格都在集合里', () => {
    expect([...occlusionCells(2, 2, 6, 6, 16)]).toEqual(['0,0'])
    const c = [...occlusionCells(5, 5, 40, 5, 16)]
    expect(c).toContain('0,0')   // 起点格
    expect(c).toContain('2,0')   // 终点格（40/16 = 2）
    expect(c.length).toBeGreaterThanOrEqual(3)
  })

  it('负坐标与轴向线段：只占一行/一列格（不撒满平面）', () => {
    const c = [...occlusionCells(-20, -20, -20, 20, 16)]
    expect(c.every((k) => k.endsWith(',-2') || k.endsWith(',-1') || k.endsWith(',1') || k.endsWith(',0'))).toBe(true)
    expect(new Set(c.map((k) => k.split(',')[0])).size).toBe(1)   // x 恒为 -2
  })

  it('采样步长 ≤ 半格：长线段不漏格（相邻格键在 x 或 y 上连续）', () => {
    const c = [...occlusionCells(0, 0, 160, 0, 16)]
    expect(c.length).toBeGreaterThanOrEqual(11)        // 0..10 格
    expect(c).toContain('10,0')
  })
})

describe('标签遮挡：只对候选格做 raycast（禁止整场景递归检测）', () => {
  const src = readFileSync(resolve(__dirname, 'playbackScene.js'), 'utf8')
  it('源码护栏：不再对 mapScenery 全量 intersectObject，改用候选列表 intersectObjects', () => {
    expect(src).not.toMatch(/intersectObject\(mapScenery, true\)/)
    expect(src).toMatch(/raycaster\.intersectObjects\(cands, false\)/)
    expect(src).toMatch(/OCCL_MAX_CANDIDATES/)
    // 候选表在场景加载时构建、换场时失效
    expect(src).toMatch(/occlGrid = occGrid;/)
    expect(src).toMatch(/occlGrid = null;/)
  })
  it('折线点表必须镜像 x（游戏系 → 场景系）——镜像丢失 = 轨迹画到地图对侧', () => {
    expect(src).toMatch(/pathPointsOf\(s\)\.map\(\(\[x, y, z\]\) => \[-x, y, z\]\)/)
    // 弹着点从镜像后的点表取（pts3[1] = via[0] 或终点），不得再读原始坐标
    expect(src).toMatch(/fromArray\(pts3\[1\]\)/)
    expect(src).not.toMatch(/fromArray\(\(s\.via && s\.via\.length\) \? s\.via\[0\] : s\.to\)/)
  })

  it('updateTracers 完成判定用 T >= tr.t1（禁止再引用已删除的旧变量 f）', () => {
    // 回归：折线改造曾把推进公式换成折线求值，却留下 `if (f >= 1)` —— f 未定义，
    // 每帧 ReferenceError 中断整个 tick（不渲染、炮线永不回收），即"播放中卡死、暂停即止"。
    expect(src).toMatch(/if \(T >= tr\.t1\) \{/)
    expect(src).not.toMatch(/f >= 1/)
    // 完成块必须仍然回收 + 生成弹着特效
    expect(src).toMatch(/if \(T >= tr\.t1\) \{[\s\S]{0,220}fxGive\('tracer', tr\.mesh\);[\s\S]{0,120}spawnImpact\(tr\);/)
  })

  it('炮线弹着特效所需的 from/to 字段仍在（折线改造曾漏掉 → ricochet 分支抛异常）', () => {
    // from/to 现在从镜像后的点表构造（pts3[0] = 炮口、impactPos = 抵达点）
    expect(src).toMatch(/from: new THREE\.Vector3\(\)\.fromArray\(pts3\[0\]\)/)
    expect(src).toMatch(/to: impactPos\.clone\(\), impactPos/)
    expect(src).toMatch(/const dir = tr\.to\.clone\(\)\.sub\(tr\.from\)\.normalize\(\)/)
    expect(src).toMatch(/const dir = tr\.to\.clone\(\)\.sub\(tr\.from\)\.normalize\(\)/)
  })
})
