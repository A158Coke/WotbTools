import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')

// 场景内核依赖 WebGL，无法直接实例化；此仓已有源码级契约测试的先例，
// 这里对 PR #411 第二轮 review 的 Blocker 3（标签软遮挡）做接线与不变量守卫。
describe('标签软遮挡（PR #411 Blocker 3）', () => {
  it('车辆标签材质不再固定半透明①：opacity 由软遮挡常量驱动', () => {
    // 回归：此前 WotbTools 标签材质仍是 opacity: 0.72（agent 侧已不透明），
    // 且无任何遮挡判定 → 实为 always-visible HUD。
    expect(src).not.toMatch(/opacity: 0\.72/)
    expect(src).toMatch(/const LABEL_OPACITY = 1;/)
    expect(src).toMatch(/const LABEL_BLOCKED_OPACITY = 0\.35;/)
  })

  it('**永不隐藏**：被挡下限严格大于 0（弱化而非消失）', () => {
    const m = src.match(/const LABEL_BLOCKED_OPACITY = ([0-9.]+);/)
    expect(m).toBeTruthy()
    const blocked = Number(m[1])
    expect(blocked).toBeGreaterThan(0)
    expect(blocked).toBeLessThan(1)
  })

  it('按 camera → 标签锚点做视线检测：地形用高度场步进、场景用 raycast', () => {
    expect(src).toMatch(/function terrainBlocksAim/)
    expect(src).toMatch(/sampleHeight\(x, z\) > y \+ 0\.5/)
    expect(src).toMatch(/function sceneryBlocksAim/)
    expect(src).toMatch(/raycaster\.intersectObject\(mapScenery, true\)/)
  })

  it('只把地形与静态场景当 blocker（不把其他车辆算遮挡）', () => {
    // 遮挡检测只查 mapScenery；不得在遮挡路径上遍历车辆（V）
    expect(src).toMatch(/if \(!mapScenery \|\| !raycaster\) return false;/)
    const occl = src.slice(src.indexOf('function terrainBlocksAim'),
                           src.indexOf('function updateLabelOcclusion'))
    expect(occl).not.toMatch(/V\.find|for \(const v of V\)|V\[/)
  })

  it('成本受控：每 occlStride 帧只检测一辆车，并按实测耗时自适应拉长步长', () => {
    expect(src).toMatch(/occlStride = Math\.min\(16, occlCostMs > LABEL_OCCL_BUDGET_MS/)
    expect(src).toMatch(/if \(\+\+occlTick < occlStride\) return;/)
    expect(src).toMatch(/const v = V\[occlCursor\+\+ % n\];/)
  })

  it('updateLabels 每帧推进遮挡并把结果落到材质透明度', () => {
    expect(src).toMatch(/function updateLabels\(\) \{\s*updateLabelOcclusion\(\);/)
    expect(src).toMatch(/const target = v\.labelOccluded \? LABEL_BLOCKED_OPACITY : LABEL_OPACITY;/)
    expect(src).toMatch(/if \(v\.label\.material\.opacity !== target\) v\.label\.material\.opacity = target;/)
  })

  it('raycast 的 far 在调用后被恢复（不污染其他射线使用点，如点选跟随）', () => {
    expect(src).toMatch(/const prevFar = raycaster\.far;\s*raycaster\.far = dist - 1\.0;/)
    expect(src).toMatch(/raycaster\.far = prevFar;/)
  })
})
