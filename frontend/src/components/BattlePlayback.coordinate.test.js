// 2.5D coordinate SSoT source regression.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./BattlePlayback.vue', import.meta.url)), 'utf8')

describe('Battle Playback 2.5D coordinate SSoT (source regression)', () => {
  it('uses the active terrain relief projection for marker/collision/transient anchors', () => {
    expect(src).toContain('activeTerrainRelief')
    expect(src).toContain('projectTerrainPoint')
    expect(src).toContain('function projectedSemanticNorm')
    expect(src).toContain('const point = projectedSemanticNorm(st.pos.x, st.pos.y)')
    expect(src).toContain('const projected = projectedSemanticNorm(s.pos.x, s.pos.y)')
    // Floating damage and destruction bursts are anchored through markerScreen -> canonicalMarkerScreen.
    expect(src).toContain('const p = markerScreen(st)')
  })

  it('uses inverse terrain projection for annotation input and projected text placement', () => {
    expect(src).toContain('unprojectTerrainPoint(model, xNorm, yNorm)')
    expect(src).toContain('projectedSemanticNorm(session.point.x, session.point.y)')
  })

  it('keeps MapRenderRect as the screen-space owner around the projected terrain', () => {
    expect(src).toContain('function mapRenderRect()')
    expect(src).toContain('point.xNorm * rect.width * view.scale + view.tx')
    expect(src).toContain('point.yNorm * rect.height * view.scale + view.ty')
  })
})
