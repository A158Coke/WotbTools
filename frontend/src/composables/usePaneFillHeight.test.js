// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { bottomSafeAreaHeight } from './usePaneFillHeight.js'

/**
 * 底部预算（design-language §9 L1 / L4）：外壳没有底部常驻栏，只扣底部安全区；
 * 探针用完即移除，不在文档里留下节点。
 */
describe('bottomSafeAreaHeight', () => {
  it('没有安全区（桌面 / 无刘海设备）：预算为 0，且不留下探针节点', () => {
    const before = document.body.childElementCount
    expect(bottomSafeAreaHeight()).toBe(0)
    expect(document.body.childElementCount).toBe(before)
  })

  it('没有 document：预算为 0', () => {
    expect(bottomSafeAreaHeight(null)).toBe(0)
  })
})
