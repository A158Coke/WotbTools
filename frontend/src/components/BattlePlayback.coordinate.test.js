import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BATTLE_PLAYBACK_SOURCE } from './battlePlayback.test.source.js'

const src = BATTLE_PLAYBACK_SOURCE
const cameraSrc = readFileSync(fileURLToPath(new URL('../composables/usePlaybackCamera.ts', import.meta.url)), 'utf8')
const selectionSrc = readFileSync(fileURLToPath(new URL('../composables/usePlaybackVehicleSelection.ts', import.meta.url)), 'utf8')
const editorSrc = readFileSync(fileURLToPath(new URL('../composables/usePlaybackAnnotationEditor.ts', import.meta.url)), 'utf8')
const replayDataSrc = readFileSync(fileURLToPath(new URL('../composables/usePlaybackReplayData.ts', import.meta.url)), 'utf8')
const projectionSrc = readFileSync(fileURLToPath(new URL('../composables/usePlaybackVehicleProjection.ts', import.meta.url)), 'utf8')

describe('Battle Playback 2.5D coordinate SSoT (source regression)', () => {
  it('uses the active terrain relief projection for marker/collision/transient anchors', () => {
    expect(replayDataSrc).toContain('activeTerrainRelief')
    expect(replayDataSrc).toContain('projectTerrainPoint')
    expect(replayDataSrc).toContain('function projectedSemanticNorm')
    expect(projectionSrc).toContain('const point = replayDataProjected(st.pos.x, st.pos.y)')
    expect(selectionSrc).toContain('projectedSemanticNorm(s.pos.x, s.pos.y)')
    expect(src).toContain('const p = S.markerScreen(st)')
  })

  it('uses inverse terrain projection for annotation input and projected text placement', () => {
    expect(replayDataSrc).toContain('unprojectTerrainPoint(model, xNorm, yNorm)')
    expect(editorSrc).toContain('projectedSemanticNorm(session.point.x, session.point.y)')
  })

  it('keeps MapRenderRect as the screen-space owner around the projected terrain', () => {
    expect(cameraSrc).toContain('function mapRenderRect()')
    expect(projectionSrc).toContain('point.xNorm * rect.width * camera.view.scale + camera.view.tx')
    expect(projectionSrc).toContain('point.yNorm * rect.height * camera.view.scale + camera.view.ty')
  })
})
