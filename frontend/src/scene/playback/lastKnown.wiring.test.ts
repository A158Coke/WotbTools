// lastKnown 接线 guard（源码级断言，风格同 cameraPreset.test.js / Replay3DPane.test.js 的
// readFileSync 源文本守卫）：回放渲染不执行浏览器，接线契约只能靠源文本锁定——
//   · labelsRuntime 不再硬编码 lastKnown:false（离场坦克必须有幽灵名牌路径）；
//   · vehicleRuntime 以协议 AoI 判别（lastKnownPoseAt）计算并放置半透明代理；
//   · 开关经 setLabelPrefs → store.lastKnownOn 推入场景（偏好 → 场景单向）。
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new NodeURL(rel, import.meta.url), 'utf8')

describe('lastKnown 接线 guard（源码级）', () => {
  it('labelsRuntime 不再硬编码 lastKnown:false', () => {
    const src = read('./labelsRuntime.ts')
    expect(src).not.toMatch(/lastKnown:\s*false/)
  })

  it('labelsRuntime 消费最后已知位姿做幽灵名牌（锚点 + 行标记 + 呈现开关门控）', () => {
    const src = read('./labelsRuntime.ts')
    // 幽灵位姿读取（vehicleRuntime.applyPose 维护的字段）与锚点场景镜像（game x 取负）
    expect(src).toMatch(/v\.lastKnownPose/)
    expect(src).toMatch(/-ghost\.pos\[0\]/)
    // 设置只门控呈现；名牌行标记来自 ghostOf
    expect(src).toMatch(/deps\.store\.lastKnownOn/)
    expect(src).toMatch(/const lastKnown = ghostOf\(v\)/)
    // 幽灵名牌不因车辆 group 隐藏而失去投影（projected 放宽到幽灵锚点）
    expect(src).toMatch(/v\.group\.visible \|\| ghostOf\(v\) != null/)
  })

  it('vehicleRuntime 以协议 AoI 判别计算最后已知位姿并放置半透明代理', () => {
    const src = read('./vehicleRuntime.ts')
    // 纯函数来源（协议 AoI 在场段判别器）+ spans/pos/grid 三输入接线
    expect(src).toMatch(/lastKnownPoseAt\(/)
    expect(src).toMatch(/deps\.visByEid\(\)\.get\(v\.def\.eid\) \?\? v\.def\.coverage/)
    expect(src).toMatch(/v\.def\.pos, deps\.poseGrid\.tStart/)
    // 半透明低模代理：复用盒体几何（trackGeo）、透明度契约 0.35、默认不可见
    expect(src).toMatch(/lastKnownProxy/)
    expect(src).toMatch(/new THREE\.Mesh\(trackGeo/)
    expect(src).toMatch(/opacity:\s*0\.35/)
    // 在场时刻必须清掉幽灵（代理与 memo 双复位）
    expect(src).toMatch(/v\.lastKnownPose = null;/)
    expect(src).toMatch(/v\.lastKnownProxy\.visible = false;/)
    // teardown 释放（材质逐车独立，不能泄漏）
    expect(src).toMatch(/disposeObject3D\(v\.lastKnownProxy\)/)
  })

  it('开关经 setLabelPrefs 推入场景并在暂停态立即重摆', () => {
    const src = read('../playbackScene.js')
    expect(src).toMatch(/store\.lastKnownOn = lastKnownOn;/)
    expect(src).toMatch(/prefs\?\.lastKnown !== false/)
    // 暂停时 applyPose 不逐帧跑：开关变化必须立即重摆一次（与 setTreadMarks 同理由）
    expect(src).toMatch(/if \(lastKnownChanged\) for \(const v of vehicles\.getVehicles\(\)\) vehicles\.applyPose\(v\);/)
  })

  it('面板持久化偏好、Display 开关与一行事实边界说明齐备', () => {
    const prefs = read('../../composables/usePlaybackPreferences.ts')
    expect(prefs).toMatch(/wotb\.pb\.last-known-prefs/)
    expect(prefs).toMatch(/showLastKnown: record\.showLastKnown !== false/)
    const pane = read('../../components/Replay3DPane.vue')
    expect(pane).toMatch(/disp-last-known/)
    expect(pane).toMatch(/replay3d-visibility-note/)
    expect(pane).toMatch(/lastKnown: lastKnownPrefs\.showLastKnown/)
    // 幽灵名牌的「最后已知」标记文案随 locale 下发（组件本身无 i18n）
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
