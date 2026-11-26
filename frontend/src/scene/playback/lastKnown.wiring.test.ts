import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { playbackSceneSource } from '../__tests__/sceneSource.ts'

const read = (rel: string) => readFileSync(new NodeURL(rel, import.meta.url), 'utf8')

describe('lastKnown 接线 guard（源码级）', () => {
  it('labelsRuntime 不再硬编码 lastKnown:false', () => {
    const src = read('./labelsRuntime.ts')
    expect(src).not.toMatch(/lastKnown:\s*false/)
  })

  it('labelsRuntime 消费最后已知位姿做幽灵名牌（锚点 + 行标记 + 呈现开关门控）', () => {
    const src = read('./labelsRuntime.ts')
    expect(src).toMatch(/v\.lastKnownPose/)
    expect(src).toMatch(/-ghost\.pos\[0\]/)
    expect(src).toMatch(/deps\.store\.lastKnownOn/)
    expect(src).toMatch(/const lastKnown = ghostOf\(v\)/)
    expect(src).toMatch(/const isGhost = ghostOf\(v\) != null/)
    expect(src).toMatch(/v\.group\.visible \|\| isGhost/)
  })

  it('vehicleRuntime 以协议 AoI 判别计算最后已知位姿并放置半透明代理', () => {
    const src = read('./vehicleRuntime.ts')
    expect(src).toMatch(/lastKnownPoseAt\(/)
    expect(src).toMatch(/deps\.visByEid\(\)\.get\(v\.def\.eid\) \?\? v\.def\.coverage/)
    expect(src).toMatch(/v\.def\.pos, deps\.poseGrid\.tStart/)
    expect(src).toMatch(/lastKnownProxy/)
    expect(src).toMatch(/new THREE\.Mesh\(trackGeo/)
    expect(src).toMatch(/opacity:\s*0\.35/)
    expect(src).toMatch(/v\.lastKnownPose = null;/)
    expect(src).toMatch(/v\.lastKnownProxy\.visible = false;/)
    expect(src).toMatch(/disposeObject3D\(v\.lastKnownProxy\)/)
  })

  it('开关经 setLabelPrefs 推入场景并在暂停态立即重摆', () => {
    const src = playbackSceneSource()
    expect(src).toMatch(/store\.lastKnownOn = lastKnownOn;/)
    expect(src).toMatch(/prefs\?\.lastKnown !== false/)
    expect(src).toMatch(/if \(lastKnownChanged\) for \(const v of vehicles\.getVehicles\(\)\) vehicles\.applyPose\(v\);/)
  })

  it('面板持久化偏好、Display 开关与一行事实边界说明齐备', () => {
    const prefs = read('../../composables/usePlaybackPreferences.ts')
    expect(prefs).toMatch(/wotb\.pb\.last-known-prefs/)
    expect(prefs).toMatch(/showLastKnown: record\.showLastKnown !== false/)
    const pane = read('../../components/Replay3DPane.vue')
    expect(pane).toMatch(/disp-last-known/)
    expect(pane).toMatch(/replay3d-visibility-note/)
    expect(pane).toContain("import { r3dB } from './replay3dPaneB.js'")
    expect(pane).toMatch(/r3dB\(S, props\)/)
    expect(read('../../components/replay3dPaneB.ts')).toMatch(/lastKnown: S\.lastKnownPrefs\.showLastKnown/)
    expect(pane).toMatch(/last-known-label="t\('agentReplay\.label_last_known'\)"/)
  })

  it('三语 locale 都带齐最后已知键（zh 为中文界面文案）', () => {
    expect(read('../../locales/zh.json')).toMatch(/"visibility_note": "回放仅包含录制客户端所见；未记录时段不重建位置，离场坦克显示最后已知位置。"/)
    for (const locale of ['zh', 'en', 'ru']) {
      const src = read(`../../locales/${locale}.json`)
      for (const key of ['display_last_known', 'label_last_known', 'visibility_note']) {
        expect(src.includes(`"${key}"`), `${locale}.${key}`).toBe(true)
      }
    }
  })
})
