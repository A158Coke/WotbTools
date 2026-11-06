// 2.5D coordinate SSoT source regression.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./BattlePlayback.vue', import.meta.url)), 'utf8')
// #820 Agent C：MapRenderRect / camera 变换的 owner 出仓到 usePlaybackCamera；守卫跟随 owner。
const cameraSrc = readFileSync(fileURLToPath(new URL('../composables/usePlaybackCamera.ts', import.meta.url)), 'utf8')
// #820 Agent C Step 2：hit-test 与文字定位的语义投影 owner 出仓到 selection / annotation editor。
const selectionSrc = readFileSync(fileURLToPath(new URL('../composables/usePlaybackVehicleSelection.ts', import.meta.url)), 'utf8')
const editorSrc = readFileSync(fileURLToPath(new URL('../composables/usePlaybackAnnotationEditor.ts', import.meta.url)), 'utf8')
// #820 Agent C Step 3：语义投影 / 地形起伏 owner 出仓到 usePlaybackReplayData；
// marker 屏幕定位 owner 出仓到 usePlaybackVehicleProjection。
const replayDataSrc = readFileSync(fileURLToPath(new URL('../composables/usePlaybackReplayData.ts', import.meta.url)), 'utf8')
const projectionSrc = readFileSync(fileURLToPath(new URL('../composables/usePlaybackVehicleProjection.ts', import.meta.url)), 'utf8')

describe('Battle Playback 2.5D coordinate SSoT (source regression)', () => {
  it('uses the active terrain relief projection for marker/collision/transient anchors', () => {
    // 地形起伏模型与语义投影 owner = usePlaybackReplayData（同一视口变换消费方共享）。
    expect(replayDataSrc).toContain('activeTerrainRelief')
    expect(replayDataSrc).toContain('projectTerrainPoint')
    expect(replayDataSrc).toContain('function projectedSemanticNorm')
    // marker 屏幕定位消费同一投影（owner = usePlaybackVehicleProjection）。
    expect(projectionSrc).toContain('const point = replayDataProjected(st.pos.x, st.pos.y)')
    // hit-test 的语义投影 owner = usePlaybackVehicleSelection（同一投影注入）。
    expect(selectionSrc).toContain('projectedSemanticNorm(s.pos.x, s.pos.y)')
    // Floating damage and destruction bursts are anchored through markerScreen -> canonicalMarkerScreen.
    expect(src).toContain('const p = markerScreen(st)')
  })

  it('uses inverse terrain projection for annotation input and projected text placement', () => {
    expect(replayDataSrc).toContain('unprojectTerrainPoint(model, xNorm, yNorm)')
    // 文字输入定位的语义投影 owner = usePlaybackAnnotationEditor（同一投影注入）。
    expect(editorSrc).toContain('projectedSemanticNorm(session.point.x, session.point.y)')
  })

  it('keeps MapRenderRect as the screen-space owner around the projected terrain', () => {
    // Owner = usePlaybackCamera（唯一 camera layer + MapRenderRect SSoT）。
    expect(cameraSrc).toContain('function mapRenderRect()')
    // 标记中心屏幕定位 owner = usePlaybackVehicleProjection（同一 MapRenderRect + view 变换）。
    expect(projectionSrc).toContain('point.xNorm * rect.width * camera.view.scale + camera.view.tx')
    expect(projectionSrc).toContain('point.yNorm * rect.height * camera.view.scale + camera.view.ty')
  })
})
