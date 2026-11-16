import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { LABEL_OCCLUDED_OPACITY } from '../utils/labelLayout.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')
// 标签软遮挡/发布实现 2026-11-06 出仓 playback/labelsRuntime.ts（#820 Step 2）
const labelsSrc = readFileSync(resolve(here, 'playback/labelsRuntime.ts'), 'utf8')
const overlay = readFileSync(resolve(here, '../components/PlaybackVehicleLabels3D.vue'), 'utf8')

// 场景内核依赖 WebGL，无法直接实例化；此仓已有源码级契约测试的先例，
// 这里对 PR #411 第二轮 review 的 Blocker 3（标签软遮挡）做接线与不变量守卫。
//
// 3D 名牌改为 HTML 覆盖层后，遮挡判定仍在场景侧（它需要 camera 与地形/场景几何），
// 但**弱化强度归呈现层**：场景只发布 `occluded` 标记，覆盖层加 `.label-occluded`。
// 因此下限只有一份事实源（utils/labelLayout.js），不再散落在 scene 常量与 CSS 里。
describe('标签软遮挡（PR #411 Blocker 3）', () => {
  it('**永不隐藏**：被挡下限严格大于 0（弱化而非消失），且只有一份事实源', () => {
    expect(LABEL_OCCLUDED_OPACITY).toBeGreaterThan(0)
    expect(LABEL_OCCLUDED_OPACITY).toBeLessThan(1)
    // 覆盖层只消费变量，不写死数值（避免同一契约散成两处）
    expect(overlay).toMatch(/classList\.toggle\('label-occluded', !!anchor\.occluded\)/)
    expect(overlay).toMatch(/\.label-occluded \{ opacity: var\(--pb-label-occluded-opacity,/)
    expect(overlay).toMatch(/import \{ LABEL_OCCLUDED_OPACITY \} from '\.\.\/utils\/labelLayout\.js'/)
  })

})
