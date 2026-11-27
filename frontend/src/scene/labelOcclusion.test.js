import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { LABEL_OCCLUDED_OPACITY } from '../utils/labelLayout.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')
const labelsSrc = readFileSync(resolve(here, 'playback/labelsRuntime.ts'), 'utf8')
const overlay = readFileSync(resolve(here, '../components/PlaybackVehicleLabels3D.vue'), 'utf8')

describe('标签软遮挡（PR #411 Blocker 3）', () => {
  it('**永不隐藏**：被挡下限严格大于 0（弱化而非消失），且只有一份事实源', () => {
    expect(LABEL_OCCLUDED_OPACITY).toBeGreaterThan(0)
    expect(LABEL_OCCLUDED_OPACITY).toBeLessThan(1)
    expect(overlay).toMatch(/classList\.toggle\('label-occluded', !!anchor\.occluded\)/)
    expect(overlay).toMatch(/\.label-occluded \{ opacity: var\(--pb-label-occluded-opacity,/)
    expect(overlay).toMatch(/import \{ LABEL_OCCLUDED_OPACITY \} from '\.\.\/utils\/labelLayout\.js'/)
  })

})
