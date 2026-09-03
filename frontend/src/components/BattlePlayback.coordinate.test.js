// §25/§26：coordinate SSoT source regression。
// 所有 presentation geometry 必须从同一个 rendered map rect（.pb-map / mapWidth()/mapHeight()）
// 推导——SVG map、HTML marker、collision、hitbox、label viewport、floats/bursts、annotation 都在
// 同一坐标系，防止 fullscreen/contain 下 marker（FV215b）跑进 gutter 的回归。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./BattlePlayback.vue', import.meta.url)), 'utf8')

describe('Battle Playback coordinate SSoT (source regression)', () => {
  it('marker % positioning (markerLeft/Top) is relative to the same mapView rect as the SVG', () => {
    // markerLeft/Top 返回 .pb-map（.pb-markers inset:0）百分比，与 SVG 同 rect
    expect(src).toContain('function markerLeft(x)')
    expect(src).toContain('mapView.value.toX(x)')
    expect(src).toContain('mapView.value.W')
    expect(src).toContain('function markerTop(y)')
    expect(src).toContain('mapView.value.toY(y)')
    expect(src).toContain('mapView.value.H')
  })

  it('MapRenderRect SSoT is the single source of truth for marker/collision/hit-test', () => {
    expect(src).toContain('function mapRenderRect()')
    expect(src).toContain('canonicalMarkerScreen(st)')
    expect(src).toContain('const rect = mapRenderRect()')
    expect(src).toContain('mapView.value.toX(st.pos.x)')
    expect(src).toContain('mapView.value.toY(st.pos.y)')
  })

  it('hit-test converts pointer via .pb-map getBoundingClientRect + mapRenderRect', () => {
    expect(src).toContain('mapEl.value.getBoundingClientRect()')
    expect(src).toContain('const rect = mapRenderRect()')
    expect(src).toContain('mapView.value.toX(s.pos.x)')
  })

  it('screenToSemantic / svgToScreen consume the same mapWidth()/mapHeight() rect', () => {
    expect(src).toContain('screenToSemantic(view, mapView.value, sp.x, sp.y, mapWidth(), mapHeight())')
    expect(src).toContain('svgToScreen(')
    expect(src).toContain('mapWidth()')
    expect(src).toContain('mapHeight()')
  })
})
