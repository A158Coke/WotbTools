import { describe, expect, it } from 'vitest'
import TANKS from './__fixtures__/upgrades/tanks.json'
import {
  buildAugmentLayout, isNodeAvailable, parseAugmentProgression,
  researchGroupChoice, researchWithPrerequisites, rollbackSubtree,
} from './tankAugmentTree'

const bz = TANKS.find(t => t.modules.tankId === 15153)!
const progression = parseAugmentProgression(bz.modules)!

describe('XI 升级研发树布局（客户端 TankProgress/UpgradeProgression）', () => {
  it('矩阵与格网：5×7，21 个带格位节点，组圆在 (3,7) 行中心线', () => {
    expect(progression.matrix).toEqual({ rows: 5, columns: 7 })
    const layout = buildAugmentLayout(progression)
    expect(layout.rows).toBe(5)
    expect(layout.columns).toBe(7)
    expect(layout.nodes).toHaveLength(progression.nodes.filter(n => n.gridPosition).length)
    expect(layout.group).toEqual({ id: progression.alternativeGroups[0].id, x: 7 * 96 + 92, y: (3 - 0.5) * 96, radius: 50 })
  })

  it('连线：每条 requiredNodes 边一条 wire，末段箭尖缩进到目标外缘', () => {
    const layout = buildAugmentLayout(progression)
    const edgeCount = progression.nodes
      .reduce((sum, n) => sum + (n.requiredNodes ?? []).filter(req => {
        const t = progression.nodes.find(x => x.techName === req)
        return t?.gridPosition != null
      }).length, 0)
    expect(layout.wires.filter(w => !w.groupId)).toHaveLength(edgeCount)
    // 每个被边指向的目标：至少一枚箭头贴其外缘（共享车道去重后仍可达）
    const arrowTips = layout.wires.flatMap(w => w.segments.filter(s => s.arrow).map(s => s.to))
    const targetsWithEdges = new Set(layout.wires.filter(w => !w.groupId).map(w => w.targetId))
    for (const targetId of targetsWithEdges) {
      const target = progression.nodes.find(n => n.id === targetId)!
      const [cx, cy] = [(target.gridPosition![1] - 0.5) * 96, (target.gridPosition![0] - 0.5) * 96]
      const nearest = Math.min(...arrowTips.map(t => Math.hypot(t[0] - cx, t[1] - cy)))
      expect(nearest).toBeLessThanOrEqual(44) // 箭尖贴目标外缘
    }
  })

  it('组边：延伸到增强圆缘（箭尖距组圆心 56），拐角前垂直箭', () => {
    const layout = buildAugmentLayout(progression)
    const groupWires = layout.wires.filter(w => w.groupId)
    expect(groupWires).toHaveLength(progression.alternativeGroups[0]!.requiredNodes!.length)
    // 组圆缘箭尖去重后仍恰一枚（三边共车道）
    const groupArrowTips = groupWires.flatMap(w => w.segments.filter(s => s.arrow).map(s => s.to))
    const atEdge = groupArrowTips.filter(t =>
      Math.abs(Math.hypot(t[0] - layout.group!.x, t[1] - layout.group!.y) - 56) < 4)
    expect(atEdge.length).toBe(1)
    // 垂直长段（≥1 格）末端带朝下/朝上箭（去重后仍至少一枚）
    const verticals = groupWires.flatMap(w => w.segments.filter(s => s.arrow && Math.abs(s.dir[1]) === 1))
    expect(verticals.length).toBeGreaterThanOrEqual(1)
  })

  it('组扇区：三段环扇 + 图标形心（半径 86，±48°/0°）', () => {
    const layout = buildAugmentLayout(progression)
    expect(layout.sectors).toHaveLength(progression.alternativeGroups[0].choices.length)
    const paths = layout.sectors.map(s => s.path)
    for (const path of paths) expect(path).toMatch(/^M[\d.-]+,[\d.-]+ L/)
    const top = layout.sectors[0]
    expect(top.cx).toBeGreaterThan(layout.group!.x) // 右侧扇区
    expect(top.cy).toBeLessThan(layout.group!.y) // 顶部
  })

  it('状态（真实 UI 形态，installed 只含数字节点/备选 id）：研发连带前置；回退卸载下游分支与组备选', () => {
    const group = progression.alternativeGroups[0]!
    const byTech = new Map(progression.nodes.map(n => [n.techName, n]))
    // 二层节点（前置有前置）：点击 → 节点 + 链上全部前置安装
    const deep = progression.nodes.find(n => n.gridPosition && (n.requiredNodes ?? [])
      .some(req => (progression.nodes.find(x => x.techName === req)?.requiredNodes ?? []).length > 0))!
    const after = researchWithPrerequisites(progression, deep.id, new Set<number>())
    expect(after.size).toBeGreaterThanOrEqual(2)
    for (const req of deep.requiredNodes ?? []) expect(after.has(byTech.get(req)!.id)).toBe(true)
    // 回退 deep：其子树卸载，前置保留
    const rollback = rollbackSubtree(progression, deep.id, after, {})
    expect(rollback.installed.has(deep.id)).toBe(false)
    for (const req of deep.requiredNodes ?? []) {
      const reqId = byTech.get(req)!.id
      if (after.has(reqId) && reqId !== deep.id) expect(rollback.installed.has(reqId)).toBe(true)
    }
    // 组（真实 UI：installed 写 choice id，组字符串 id 永不写入）：装满三条前置链 +
    // 备选后，回退其中一条链的根 → 该链全部节点 + 组全部备选级联卸载 + 三选一清除
    const chainRootOf = (tech: string): string => {
      let cur = tech
      for (;;) {
        const up = (byTech.get(cur)!.requiredNodes ?? [])[0]
        if (!up) return cur
        cur = up
      }
    }
    const chainRoot = byTech.get(chainRootOf(group.requiredNodes![0]!))!
    const withGroup = new Set<number>()
    for (const req of group.requiredNodes ?? []) {
      researchWithPrerequisites(progression, byTech.get(req)!.id, withGroup)
        .forEach(id => withGroup.add(id))
    }
    withGroup.add(group.choices[0]!)
    const chosen = { [group.id]: group.choices[0]! }
    const rolled = rollbackSubtree(progression, chainRoot.id, withGroup, chosen)
    expect(rolled.installed.has(chainRoot.id)).toBe(false)
    for (const c of group.choices) expect(rolled.installed.has(c)).toBe(false)
    expect(rolled.chosen[group.id]).toBeUndefined()
    // 其余两条链的前置与备选无关节点保留（只回退被回退链的下游）
    expect(rolled.installed.has(byTech.get(group.requiredNodes![1]!)!.id)).toBe(true)
  })

  it('researchGroupChoice：组前置链 + 备选，组内互斥（树与配置卡共用）', () => {
    const group = progression.alternativeGroups[0]!
    const byTech = new Map(progression.nodes.map(n => [n.techName, n]))
    // 空状态点备选 22 → 三条前置链全部补齐 + 22
    const next = researchGroupChoice(progression, group.id, group.choices[0]!, new Set<number>())
    for (const req of group.requiredNodes ?? []) expect(next.has(byTech.get(req)!.id)).toBe(true)
    expect(next.has(group.choices[0]!)).toBe(true)
    // 换选到 23：22 被替换（组内互斥），前置保留
    const swapped = researchGroupChoice(progression, group.id, group.choices[1]!, next)
    expect(swapped.has(group.choices[0]!)).toBe(false)
    expect(swapped.has(group.choices[1]!)).toBe(true)
    for (const req of group.requiredNodes ?? []) expect(swapped.has(byTech.get(req)!.id)).toBe(true)
    // 非法备选/组 id 原样返回
    expect([...researchGroupChoice(progression, group.id, 999999, next)]).toEqual([...next])
    expect([...researchGroupChoice(progression, 'no-such-group', group.choices[0]!, next)]).toEqual([...next])
  })

  it('可用性：前置未齐不可用', () => {
    const node = progression.nodes.find(n => n.gridPosition && (n.requiredNodes ?? []).length > 0)!
    const empty = new Set<number>()
    expect(isNodeAvailable(node, empty, progression)).toBe(false)
    const allPrereqs = new Set((node.requiredNodes ?? [])
      .map(req => progression.nodes.find(n => n.techName === req)!.id))
    expect(isNodeAvailable(node, allPrereqs, progression)).toBe(true)
  })
})
