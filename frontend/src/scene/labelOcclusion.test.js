import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { LABEL_OCCLUDED_OPACITY } from '../utils/labelLayout.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')
const overlay = readFileSync(resolve(here, '../components/PlaybackVehicleLabels3D.vue'), 'utf8')

// 场景内核依赖 WebGL，无法直接实例化；此仓已有源码级契约测试的先例，
// 这里对 PR #411 第二轮 review 的 Blocker 3（标签软遮挡）做接线与不变量守卫。
//
// 3D 名牌改为 HTML 覆盖层后，遮挡判定仍在场景侧（它需要 camera 与地形/场景几何），
// 但**弱化强度归呈现层**：场景只发布 `occluded` 标记，覆盖层加 `.label-occluded`。
// 因此下限只有一份事实源（utils/labelLayout.js），不再散落在 scene 常量与 CSS 里。
describe('标签软遮挡（PR #411 Blocker 3）', () => {
  it('车辆标签材质不再固定半透明：遮挡标记由场景发布、强度由覆盖层消费', () => {
    // 回归：此前 WotbTools 标签材质仍是 opacity: 0.72（agent 侧已不透明），
    // 且无任何遮挡判定 → 实为 always-visible HUD。
    expect(src).not.toMatch(/opacity: 0\.72/)
    // 场景只发布标记，不再自带透明度常量
    expect(src).toMatch(/v\.labelOccluded = blocked;/)
    expect(src).toMatch(/labelAnchorScratch\.occluded = v\.labelOccluded;/)
    expect(src).not.toMatch(/const LABEL_(BLOCKED_)?OPACITY = /)
  })

  it('**永不隐藏**：被挡下限严格大于 0（弱化而非消失），且只有一份事实源', () => {
    expect(LABEL_OCCLUDED_OPACITY).toBeGreaterThan(0)
    expect(LABEL_OCCLUDED_OPACITY).toBeLessThan(1)
    // 覆盖层只消费变量，不写死数值（避免同一契约散成两处）
    expect(overlay).toMatch(/classList\.toggle\('label-occluded', !!anchor\.occluded\)/)
    expect(overlay).toMatch(/\.label-occluded \{ opacity: var\(--pb-label-occluded-opacity,/)
    expect(overlay).toMatch(/import \{ LABEL_OCCLUDED_OPACITY \} from '\.\.\/utils\/labelLayout\.js'/)
  })

  it('按 camera → 标签锚点做视线检测：地形用高度场步进、场景用 raycast', () => {
    expect(src).toMatch(/function terrainBlocksAim/)
    expect(src).toMatch(/sampleHeight\(x, z\) > y \+ 0\.5/)
    expect(src).toMatch(/function sceneryBlocksAim/)
    // 2026-10-05：整场景递归 raycast 是"打起来后间歇卡死"的根因（单次可达数十~数百 ms，
    // 场景 GLB 3000+ 节点）→ 改为只对**线段经过的 16m 候选格**内的网格检测（见
    // playbackScene.occlusion.test.js：禁止回退成全量检测）
    expect(src).toMatch(/raycaster\.intersectObjects\(cands, false\)/)
  })

  it('只把地形与静态场景当 blocker（不把其他车辆算遮挡）', () => {
    // 遮挡检测只查 mapScenery；不得在遮挡路径上遍历车辆（V）
    expect(src).toMatch(/if \(!mapScenery \|\| !raycaster \|\| !occlGrid\) return false;/)
    const occl = src.slice(src.indexOf('function terrainBlocksAim'),
                           src.indexOf('function updateLabelOcclusion'))
    expect(occl).not.toMatch(/V\.find|for \(const v of V\)|V\[/)
  })

  it('成本受控：每 occlStride 帧只检测一辆车，并按实测耗时自适应拉长步长', () => {
    expect(src).toMatch(/occlStride = Math\.min\(16, occlCostMs > LABEL_OCCL_BUDGET_MS/)
    expect(src).toMatch(/if \(\+\+occlTick < occlStride\) return;/)
    expect(src).toMatch(/const v = V\[occlCursor\+\+ % n\];/)
  })

  it('updateLabels 每帧推进遮挡，并把结果作为 anchor 的 occluded 发布出去', () => {
    const update = src.slice(src.indexOf('function updateLabels'), src.indexOf('function buildVehicles'))
    expect(update).toMatch(/updateLabelOcclusion\(\);/)
    expect(update).toMatch(/labelAnchorScratch\.occluded = v\.labelOccluded;/)
  })

  it('raycast 的 far 在调用后被恢复（不污染其他射线使用点，如点选跟随）', () => {
    expect(src).toMatch(/const prevFar = raycaster\.far;\s*raycaster\.far = dist - 1\.0;/)
    expect(src).toMatch(/raycaster\.far = prevFar;/)
  })
})
