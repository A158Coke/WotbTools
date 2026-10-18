import { describe, it, expect } from 'vitest'
import { activeVariantOf, pruneForeignVariants, pruneForeignVariantsDetailed } from './variantFilter.js'

// 最小节点 fake：children + parent.remove（与 three Object3D 接口同形）
function node(extras = {}, children = []) {
  const n = {
    userData: { ...extras },
    children,
    parent: null,
    remove(...kids) {
      for (const k of kids) {
        k.parent = null
        this.children = this.children.filter((c) => c !== k)
      }
    },
  }
  for (const c of children) c.parent = n
  return n
}
describe('activeVariantOf', () => {
  it('按 map_id（含字符串键）取激活标签', () => {
    const m = { 7: 'md1', 46: 'md2', 47: 'md3' }
    expect(activeVariantOf(m, 7)).toBe('md1')
    expect(activeVariantOf(m, '47')).toBe('md3')
  })
  it('无映射 / 口径外 mapId → null（调用方据此 fail-closed）', () => {
    expect(activeVariantOf(null, 7)).toBeNull()
    expect(activeVariantOf({}, 7)).toBeNull()
    expect(activeVariantOf({ 7: 'md1' }, 46)).toBeNull()
    expect(activeVariantOf({ 7: 42 }, 7)).toBeNull()  // 非字符串值口径外
  })
})

describe('pruneForeignVariants', () => {
  it('剔除非激活变体节点（含子树），保留激活组与无标签节点', () => {
    const stone = node({ mdVariant: 'md3' })
    const wall = node({ mdVariant: 'md3' })
    const tree = node({})                       // 无标签 = 全变体共有
    const md1tree = node({ mdVariant: 'md1' })  // 本变体组
    const root = node({ variantByMapId: { 7: 'md1', 46: 'md2', 47: 'md3' } },
      [stone, tree, md1tree, wall])
    expect(pruneForeignVariants(root, 7)).toBe(2)
    expect(root.children).toEqual([tree, md1tree])
  })
  it('深层子树里的变体节点同样命中', () => {
    const stone = node({ mdVariant: 'md3' })
    const group = node({}, [stone])
    const root = node({ variantByMapId: { 7: 'md1', 47: 'md3' } }, [group])
    expect(pruneForeignVariants(root, 47)).toBe(0)
    expect(pruneForeignVariants(root, 7)).toBe(1)
    expect(group.children).toEqual([])
  })
  it('有变体节点但没有可用激活组 → fail-closed，隐藏全部带标记节点', () => {
    // 旧行为是 fail-open 全量渲染（幻影布景）；现在映射缺失/mapId 缺失都不得猜默认组。
    const noMapping = node({}, [node({ mdVariant: 'md3' })])
    expect(pruneForeignVariants(noMapping, 7)).toBe(1)
    expect(noMapping.children).toEqual([])

    const missingId = node({ variantByMapId: { 7: 'md1' } }, [node({ mdVariant: 'md3' })])
    expect(pruneForeignVariants(missingId, 46)).toBe(1)
    expect(missingId.children).toEqual([])

    // 没有变体节点时仍是 no-op（单变体/普通场景）
    const plain = node({}, [node({})])
    expect(pruneForeignVariants(plain, 7)).toBe(0)
    expect(plain.children).toHaveLength(1)
    expect(pruneForeignVariants(node({ variantByMapId: { 7: 'md1' } }, [node({})]), 46)).toBe(0)
  })
})


describe('pruneForeignVariantsDetailed：fail-closed 信号（运行时降级 / 烘焙中止）', () => {
  it('正常裁剪 failClosed=false；映射缺失时 failClosed=true', () => {
    const activeRoot = node({ variantByMapId: { 7: 'md1' } }, [node({ mdVariant: 'md3' }), node({})])
    expect(pruneForeignVariantsDetailed(activeRoot, 7)).toEqual({ removed: 1, failClosed: false })
    const noMapping = node({}, [node({ mdVariant: 'md3' })])
    expect(pruneForeignVariantsDetailed(noMapping, 7)).toEqual({ removed: 1, failClosed: true })
    const noTagged = node({}, [node({})])
    expect(pruneForeignVariantsDetailed(noTagged, 7)).toEqual({ removed: 0, failClosed: false })
  })
})
