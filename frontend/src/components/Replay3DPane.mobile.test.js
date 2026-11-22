// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  installPaneTestLifecycle, mountPane, mockWebGL, mkFile, flush, start, openDetailsViaScene,
  paneComponent, translate, here, testState, fullscreenCalls,
  nextTick, ref, shallowReactive, mount, readFileSync, fileURLToPath, dirname, resolve,
  makeBattlePlaybackDataset, zh, en, ru,
} from './Replay3DPane.test.harness.js'

const { canonical, playback, layout, connectivityState } = testState

installPaneTestLifecycle()

describe('Replay3DPane mobile / fullscreen / roster', () => {
  /**
   * 手机竖屏呈现（真机 blocker）：常驻控件只能占「时间轴 + 一行高频按钮」。
   *
   * 这些用例断言**行为 / 不变量**，不锁像素：
   *   · 工具条整行在紧凑档不常驻（`display:none` 由 CSS 承担，DOM 仍在但不可见）；
   *   · 二级控件（相机 / 阵容 / 画质）改在「显示」面板里，且可开可关；
   *   · 开关面板**不重建场景**（同一 sceneApi 实例，session 不重置）。
   */
  describe('手机竖屏：二级控件收进「显示」面板', () => {
    const roster = {
      team1: [{ eid: 1, team: 1, nick: 'A', tank: 'T', hp: 1, maxHp: 2, dead: false, followed: false }],
      team2: [], unknown: [],
    }

    it('紧凑档与宽档共享 Display 相机设置；两档都没有「打开名册」按钮', async () => {
      mockWebGL('webgl2')
      layout.compact = true
      layout.portrait = true
      const compactPane = mountPane()
      const compactStore = playback.api.store
      compactStore.hasData = true
      compactStore.roster = roster
      await nextTick()
      // 镜头挡位**直接陈列**在控制条（2026-10-05：从 Gear 面板移出）
      expect(compactPane.find('[data-testid="replay3d-camera"]').exists()).toBe(true)
      await compactPane.get('[data-testid="display-toggle"]').trigger('click')
      expect(compactPane.find('[data-testid="display-panel"] .dp-camera').exists()).toBe(false)
      // 名册没有临时面入口：唯一开关是 disp-roster 呈现偏好
      expect(compactPane.find('[data-testid="disp-roster"]').exists()).toBe(true)
      compactPane.unmount()

      layout.compact = false
      layout.portrait = false
      const widePane = mountPane()
      const wideStore = playback.api.store
      wideStore.hasData = true
      wideStore.roster = roster
      await nextTick()
      await widePane.get('[data-testid="display-toggle"]').trigger('click')
      // Wide form 同为直接陈列（两档同一入口）
      expect(widePane.find('[data-testid="replay3d-camera"]').exists()).toBe(true)
      expect(widePane.find('[data-testid="roster-toggle-compact"]').exists()).toBe(false)
      expect(widePane.find('[data-testid="roster-toggle"]').exists()).toBe(false)
      widePane.unmount()
      layout.compact = false
    })

    it('紧凑档：面板可开、可关、可关掉即恢复无遮挡；开合不得重建场景或重置会话', async () => {
      mockWebGL('webgl2')
      layout.compact = true
      const wrapper = mountPane()
      await start(wrapper)
      const apiAfterStart = playback.api
      expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)

      await wrapper.get('[data-testid="display-toggle"]').trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="display-close"]').exists()).toBe(true)
      // 面板只是覆盖层：不改变 playback session 身份，也不重建场景
      expect(playback.api).toBe(apiAfterStart)
      expect(playback.init).toHaveBeenCalledTimes(1)
      expect(playback.api.reset).not.toHaveBeenCalled()

      await wrapper.get('[data-testid="display-close"]').trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
      expect(playback.api).toBe(apiAfterStart)
      expect(playback.init).toHaveBeenCalledTimes(1)
      wrapper.unmount()
      layout.compact = false
    })

    it('紧凑档：俯视动作在控制条直接触发，走同一个 setCam（不新建移动端相机状态）', async () => {
      mockWebGL('webgl2')
      layout.compact = true
      layout.portrait = true
      const wrapper = mountPane()
      const store = playback.api.store
      store.hasData = true
      store.roster = roster
      await nextTick()
      // 折叠状态也可切换（不依赖 Display 面板）；默认已是 top，先切到 free 再点 top
      store.cam = 'free'
      await nextTick()
      await wrapper.get('[data-testid="replay3d-top-view"]').trigger('click')
      expect(playback.api.setCam).toHaveBeenLastCalledWith('top-view')
      wrapper.unmount()
      layout.portrait = false
    })

    it('手机横屏：控制条只留传输，镜头进 Display，且不新建第二份相机状态', async () => {
      mockWebGL('webgl2')
      layout.compact = true
      const wrapper = mountPane()
      const store = playback.api.store
      store.hasData = true
      store.roster = roster
      await nextTick()
      expect(wrapper.get('[data-testid="replay3d-root"]').classes()).toContain('compact-bar')
      expect(wrapper.find('[data-testid="replay3d-camera"]').exists()).toBe(false)
      await wrapper.get('[data-testid="display-toggle"]').trigger('click')
      expect(wrapper.find('[data-testid="display-panel"] [data-testid="replay3d-camera"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="display-panel"] [data-testid="replay3d-drawing-entry"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="replay3d-drawing-entry"]').element.parentElement.classList.contains('controls')).toBe(true)
      expect(wrapper.get('[data-testid="replay3d-toolrow"] label').text()).toContain('agentReplay.glb')
      store.cam = 'free'
      await nextTick()
      await wrapper.get('[data-testid="replay3d-top-view"]').trigger('click')
      expect(playback.api.setCam).toHaveBeenLastCalledWith('top-view')
      wrapper.unmount()
      layout.compact = false
    })

    it('紧凑档：画质是只读徽标，与工具条共用同一个 qualityBadge 来源', async () => {
      mockWebGL('webgl2')
      layout.compact = true
      const wrapper = mountPane()
      const { store } = playback.api
      store.hasData = true
      await nextTick()
      await wrapper.get('[data-testid="display-toggle"]').trigger('click')
      await nextTick()
      const badge = wrapper.get('[data-testid="display-panel"] .dp-quality')
      expect(badge.text().length).toBeGreaterThan(0)
      wrapper.unmount()
      layout.compact = false
    })
  })

  /**
   * 3D 全屏：与 2D 同一套产品语义（composables/usePlaybackFullscreen），
   * 且**纯呈现 / 生命周期切换**——场景、解析、时间、倍速、相机、跟随目标、偏好都不重置。
   */
  describe('3D 全屏（与 2D 同语义）', () => {
    /**
     * Fullscreen 能力桩：happy-dom **不提供** `requestFullscreen`，而能力探测读的是
     * 真实元素上的方法。所以任何期望看到全屏按钮的用例都必须先装上它——以前靠
     * `v-if="fullscreenSupported"`（函数对象恒真）侥幸通过，现在探测正确了，就必须显式声明能力。
     */
    const withRequestFullscreen = (available, fn) => {
      fullscreenCalls.request = 0
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
      const proto = Object.getPrototypeOf(document.createElement('div'))
      const saved = Object.getOwnPropertyDescriptor(proto, 'requestFullscreen')
      if (available) {
        Object.defineProperty(proto, 'requestFullscreen', {
          value: function requestFullscreen() {
            fullscreenCalls.request++
            Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true })
            document.dispatchEvent(new Event('fullscreenchange'))
            return Promise.resolve()
          },
          configurable: true, writable: true,
        })
      } else {
        Object.defineProperty(proto, 'requestFullscreen', { value: undefined, configurable: true, writable: true })
      }
      return Promise.resolve()
        .then(fn)
        .finally(() => {
          if (saved) Object.defineProperty(proto, 'requestFullscreen', saved)
          else delete proto.requestFullscreen
        })
    }

    it('全屏是主操作：常驻在传输控件行里，不在「显示」面板内（一键直达）', async () => {
      await withRequestFullscreen(true, async () => {
        mockWebGL('webgl2')
        const wrapper = mountPane()
        const { store } = playback.api
        store.hasData = true
        await nextTick()
        const btn = wrapper.get('[data-testid="playback-fullscreen"]')
        // 它必须在面板**之外**（面板是二级设置，不允许把全屏藏进去）
        await wrapper.get('[data-testid="display-toggle"]').trigger('click')
        expect(wrapper.get('[data-testid="display-panel"]').element.contains(btn.element)).toBe(false)
        expect(btn.attributes('aria-pressed')).toBe('false')
        wrapper.unmount()
      })
    })

    /**
     * BLOCKER 2A：这条用例以前是**假阳**——它写的是 `playback.api.hasData = true`，
     * 而真实响应式状态在 `playback.api.store.hasData`。于是 `.controls` 从未渲染，
     * 全屏按钮无论如何都不存在，用例对错误的实现（`v-if="fullscreenSupported"`，
     * 函数对象恒真）也照样通过。
     *
     * 现在两条都**先证明控件确实渲染**（`[data-test=pb-controls]` / `pb-play` 存在），
     * 再只对全屏动作做断言。不支持的那条对错误实现必然失败：函数对象为真 → 按钮仍会渲染。
     */
    describe('全屏能力探测（控件确实渲染后才断言）', () => {
      const mountReady = async () => {
        mockWebGL('webgl2')
        const wrapper = mountPane()
        playback.api.store.hasData = true
        await nextTick()
        return wrapper
      }

      it('requestFullscreen 可用 → 控件渲染且全屏动作存在', async () => {
        await withRequestFullscreen(true, async () => {
          const wrapper = await mountReady()
          // 先证明控件确实渲染（否则下面的断言什么都证明不了）
          expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
          expect(wrapper.find('[data-test="pb-play"]').exists()).toBe(true)
          expect(wrapper.find('[data-testid="playback-fullscreen"]').exists()).toBe(true)
          wrapper.unmount()
        })
      })

      it('requestFullscreen 不可用 → 控件照常渲染，但全屏动作不存在（不画假按钮）', async () => {
        await withRequestFullscreen(false, async () => {
          const wrapper = await mountReady()
          // 关键：控件**确实渲染了**，所以"没有全屏按钮"只能归因于能力探测
          expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
          expect(wrapper.find('[data-test="pb-play"]').exists()).toBe(true)
          expect(wrapper.find('[data-testid="playback-fullscreen"]').exists()).toBe(false)
          wrapper.unmount()
        })
      })

      it('能力在挂载后可用时也会出现（computed 跟随 target）', async () => {
        await withRequestFullscreen(false, async () => {
          const wrapper = await mountReady()
          expect(wrapper.find('[data-testid="playback-fullscreen"]').exists()).toBe(false)
          // 运行中恢复能力（等价于探测读到的元素变了）→ 重新渲染后按钮出现
          const proto = Object.getPrototypeOf(document.createElement('div'))
          Object.defineProperty(proto, 'requestFullscreen', {
            value: function requestFullscreen() { return Promise.resolve() },
            configurable: true, writable: true,
          })
          const remounted = await mountReady()
          expect(remounted.find('[data-testid="playback-fullscreen"]').exists()).toBe(true)
          wrapper.unmount()
          remounted.unmount()
        })
      })
    })

    it('进入 / 退出全屏不重建场景、不重解析、不重置时间·倍速·相机·偏好', async () => {
      // 能力必须在**挂载前**就位：探测在渲染时求值，之后才装上的按钮不会出现
      await withRequestFullscreen(true, async () => {
        mockWebGL('webgl2')
        const wrapper = mountPane()
        await start(wrapper)
        const api = playback.api
        const { store } = api
        store.hasData = true
        store.time = 42
        store.speed = 4
        store.cam = 'follow'
        const rootEl = wrapper.get('.pb-root').element
        Object.defineProperty(document, 'exitFullscreen', {
          configurable: true,
          value: vi.fn(() => {
            Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
            document.dispatchEvent(new Event('fullscreenchange'))
            return Promise.resolve()
          }),
        })
        await nextTick()
        const initCallsBefore = playback.init.mock.calls.length
        // start() 之后解析已经发生一次（那是播放器启动，不是全屏造成的）；全屏往返不得再增
        const loadCallsBefore = api.loadData.mock.calls.length
        await wrapper.get('[data-testid="playback-fullscreen"]').trigger('click')
        await nextTick()
        expect(fullscreenCalls.request).toBe(1)
        expect(wrapper.get('[data-testid="playback-fullscreen"]').attributes('aria-pressed')).toBe('true')
        // 会话原封不动
        expect(playback.init.mock.calls.length).toBe(initCallsBefore)
        expect(api.reset).not.toHaveBeenCalled()
        expect(api.loadData.mock.calls.length).toBe(loadCallsBefore)
        expect(store.time).toBe(42)
        expect(store.speed).toBe(4)
        expect(store.cam).toBe('follow')
        // 退出：同一会话继续，状态依旧
        await wrapper.get('[data-testid="playback-fullscreen"]').trigger('click')
        await nextTick()
        expect(wrapper.get('[data-testid="playback-fullscreen"]').attributes('aria-pressed')).toBe('false')
        expect(playback.init.mock.calls.length).toBe(initCallsBefore)
        expect(store.time).toBe(42)
        expect(store.speed).toBe(4)
        expect(store.cam).toBe('follow')
        wrapper.unmount()
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
      })
    })

    it('Android 手机 App 自动全屏：已开播且有数据才进入一次；退出后不重入，会话与相机不变，新事件才再进入', async () => {
      await withRequestFullscreen(true, async () => {
        mockWebGL('webgl2')
        const wrapper = mountPane({ autoFullscreenToken: 1 })
        const { store } = playback.api
        await flush()
        // 待开播（用户未按开始）、尚无数据：不触发
        expect(fullscreenCalls.request).toBe(0)
        await start(wrapper)
        store.time = 42
        store.speed = 4
        store.cam = 'follow'
        Object.defineProperty(document, 'exitFullscreen', {
          configurable: true,
          value: vi.fn(() => {
            Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
            document.dispatchEvent(new Event('fullscreenchange'))
            return Promise.resolve()
          }),
        })
        store.hasData = true
        await flush()
        expect(fullscreenCalls.request).toBe(1)
        const initCalls = playback.init.mock.calls.length
        const loadCalls = playback.api.loadData.mock.calls.length
        await document.exitFullscreen()
        await flush()
        expect(wrapper.get('[data-testid="playback-fullscreen"]').attributes('aria-pressed')).toBe('false')
        expect(playback.init.mock.calls.length).toBe(initCalls)
        expect(playback.api.loadData.mock.calls.length).toBe(loadCalls)
        expect(playback.api.reset).not.toHaveBeenCalled()
        expect([store.time, store.speed, store.cam]).toEqual([42, 4, 'follow'])
        expect(fullscreenCalls.request).toBe(1)
        await wrapper.setProps({ autoFullscreenToken: 2 })
        await flush()
        expect(fullscreenCalls.request).toBe(2)
        wrapper.unmount()
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
      })
    })

    it('外部退出全屏（ESC / 系统手势）后状态同步回 false', async () => {
      await withRequestFullscreen(true, async () => {
        mockWebGL('webgl2')
        const wrapper = mountPane()
        playback.api.store.hasData = true
        await nextTick()
        await wrapper.get('[data-testid="playback-fullscreen"]').trigger('click')
        await nextTick()
        expect(wrapper.get('[data-testid="playback-fullscreen"]').attributes('aria-pressed')).toBe('true')
        // 外部退出：不经过我们的 toggle
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
        document.dispatchEvent(new Event('fullscreenchange'))
        await nextTick()
        expect(wrapper.get('[data-testid="playback-fullscreen"]').attributes('aria-pressed')).toBe('false')
        wrapper.unmount()
      })
    })

    it('全屏入口三态：竖屏浮动、横屏内联、隐藏 UI 只有一个可达入口', async () => {
      await withRequestFullscreen(true, async () => {
        // 布局 mock 是普通对象（只在挂载时读取），因此三态各挂载一次；真实旋转
        // 由 browser harness 的 portrait-to-landscape 场景独立验证。
        const mountAt = async ({ compact, portrait }) => {
          layout.compact = compact
          layout.portrait = portrait
          mockWebGL('webgl2')
          const wrapper = mountPane()
          playback.api.store.hasData = true
          await nextTick()
          return wrapper
        }
        // 手机竖屏：原契约——右上浮动，传输条不重复渲染。
        let wrapper = await mountAt({ compact: true, portrait: true })
        let entries = () => wrapper.findAll('[data-test="pb-fullscreen"]')
        expect(entries()).toHaveLength(1)
        expect(entries()[0].classes()).toContain('floating')
        expect(wrapper.find('.controls [data-test="pb-fullscreen"]').exists()).toBe(false)
        wrapper.unmount()
        // 手机横屏：入口变成传输条内联，浮钮消失。
        wrapper = await mountAt({ compact: true, portrait: false })
        entries = () => wrapper.findAll('[data-test="pb-fullscreen"]')
        expect(entries()).toHaveLength(1)
        expect(entries()[0].classes()).not.toContain('floating')
        expect(wrapper.find('.controls [data-test="pb-fullscreen"]').exists()).toBe(true)
        // 横屏隐藏全部 UI：浮钮是唯一入口，恢复 UI 后回到内联，仍不重复。
        await wrapper.get('[data-testid="display-toggle"]').trigger('click')
        await wrapper.get('[data-testid="hide-all-ui"]').trigger('click')
        await nextTick()
        expect(entries()).toHaveLength(1)
        expect(entries()[0].classes()).toContain('floating')
        expect(wrapper.find('.controls [data-test="pb-fullscreen"]').exists()).toBe(false)
        await wrapper.get('[data-testid="show-all-ui"]').trigger('click')
        await nextTick()
        expect(entries()).toHaveLength(1)
        expect(entries()[0].classes()).not.toContain('floating')
        expect(wrapper.find('.controls [data-test="pb-fullscreen"]').exists()).toBe(true)
        wrapper.unmount()
        // 桌面：保持既有内联行为（isPhone=false 不触发 floatingFullscreen）。
        wrapper = await mountAt({ compact: false, portrait: false })
        entries = () => wrapper.findAll('[data-test="pb-fullscreen"]')
        expect(entries()).toHaveLength(1)
        expect(entries()[0].classes()).not.toContain('floating')
        expect(wrapper.find('.controls [data-test="pb-fullscreen"]').exists()).toBe(true)
        wrapper.unmount()
        layout.compact = false
        layout.portrait = false
      })
    })
  })

  /**
   * 需求 13：名册**不得**是嵌套滚动盒；行点击 = 跟随 + 选中 + 详情。
   */
  describe('名册：无嵌套滚动 + 行点击语义', () => {
    const roster = {
      team1: [
        { eid: 11, team: 1, nick: 'Alpha', tank: 'Kranvagn', hp: 1800, maxHp: 1950, dead: false, followed: false, color: 'c1' },
        { eid: 12, team: 1, nick: 'Bravo', tank: 'E 75', hp: 0, maxHp: 1900, dead: true, followed: false, color: 'c1' },
      ],
      team2: [{ eid: 21, team: 2, nick: 'Enemy', tank: 'T-62A', hp: 900, maxHp: 2000, dead: false, followed: true, color: 'c2' }],
      unknown: [],
    }

    it('队面板不得是独立滚动容器（常规名册必须一屏看全）', () => {
      // Replay3DPane.vue 只保留 <style scoped src="./replay3dPane.css">；必须校验它实际引用的
      // 活跃样式，而不是旁边同名未引用的 replay3d-pane.css。选择器缺失时测试必须失败。
      const paneVue = readFileSync(resolve(here, 'Replay3DPane.vue'), 'utf8')
      const activeCss = /<style\s+scoped\s+src="\.\/([^"]+\.css)"\s*(?:\/>|><\/style>)/.exec(paneVue)?.[1]
      expect(activeCss).toBeTruthy()
      const paneCss = readFileSync(resolve(here, activeCss), 'utf8')

      // 车道基础规则不是滚动盒；三段式里的 overflow 只是病态数据的兜底，
      // 正常 7v7 不出现滚动条由浏览器门禁（roster-geometry-*）在真实布局里断言。
      const laneBlock = /^\.team-lane \{([^}]*)\}/m.exec(paneCss)?.[1]
      expect(laneBlock).toBeTruthy()
      expect(laneBlock).not.toContain('overflow')

      // 名册容器规则在 PlaybackRoster.vue 的 scoped style，不写死宽度、不是独立滚动区。
      const rosterVue = readFileSync(resolve(here, 'PlaybackRoster.vue'), 'utf8')
      const rosterBlock = /^\.pb-roster \{([^}]*)\}/m.exec(rosterVue)?.[1]
      expect(rosterBlock).toBeTruthy()
      expect(rosterBlock).not.toContain('overflow')

      // 临时名册面整套规则已不存在
      expect(paneCss + rosterVue).not.toMatch(/\.roster-surface\.transient|rosterTransient|rosterConstrained/)
    })

    it('点一行 = 跟随该玩家坦克 + 高亮，不再打开详情窗（2026-10-05 需求）', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      await nextTick()
      const rows = wrapper.findAll('.team-lane .pl')
      expect(rows.length).toBe(3)
      await rows[0].trigger('click')
      // 跟随（相机动作）：setFollow 独占，由内核同时切 follow 档
      expect(api.setFollow).toHaveBeenCalledExactlyOnceWith(11)
      // 选中（行状态高亮）
      expect(rows[0].classes()).toContain('selected')
      // 详情窗**不**打开（原绑定已删除）
      expect(wrapper.find('[data-testid="replay3d-details"]').exists()).toBe(false)
      // 再点另一行（Enemy, eid=21）：跟随目标切换（重新查询行——上一行点击触发了重渲染）
      const enemyRow = wrapper.findAll('.team-lane .pl').find((r) => r.text().includes('Enemy'))
      await enemyRow.trigger('click')
      expect(api.setFollow).toHaveBeenLastCalledWith(21)
      expect(wrapper.find('[data-testid="replay3d-details"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('scene selection opens shared details and follows; Top/Free preserve selection', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      await nextTick()
      const onVehicleSelect = playback.init.mock.calls.at(-1)[3].onVehicleSelect
      onVehicleSelect(11)
      await nextTick()
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Alpha')
      expect(api.setFollow).toHaveBeenCalledExactlyOnceWith(11)
      // 镜头挡位直接陈列在控制条（2026-10-05：从 Display 面板移出），不经菜单
      expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
      api.store.cam = 'free'
      await nextTick()
      await wrapper.get('[data-testid="replay3d-top-view"]').trigger('click')
      expect(api.setCam).toHaveBeenLastCalledWith('top-view')
      api.store.cam = 'free'
      await nextTick()
      expect(wrapper.get('[data-testid="replay3d-camera"] [data-value="free"]').attributes('aria-checked')).toBe('true')
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Alpha')
      // 跟随没有档位：只由点车或点名单触发，radio 仍选中自由，再点一次退出
      expect(wrapper.find('[data-testid="replay3d-camera"] [data-value="follow"]').exists()).toBe(false)
      onVehicleSelect(21)
      await nextTick()
      expect(api.setFollow).toHaveBeenLastCalledWith(21)
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Enemy')
      api.store.cam = 'follow'
      await nextTick()
      const free = wrapper.get('[data-testid="replay3d-camera"] [data-value="free"]')
      expect(free.attributes('aria-checked')).toBe('true')
      await free.trigger('click')
      expect(api.setCam).toHaveBeenLastCalledWith('free')
      // 点场景空处（eid=null）→ 详情窗隐藏，跟随不变
      onVehicleSelect(null)
      await nextTick()
      expect(wrapper.find('[data-testid="replay3d-details"]').exists()).toBe(false)
      expect(api.setFollow).toHaveBeenCalledTimes(2)
      wrapper.unmount()
    })

    it('场景点选带真实事件时按点击原点定详情落位（不抛错、不误判左右）', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      await nextTick()
      const onVehicleSelect = playback.init.mock.calls.at(-1)[3].onVehicleSelect
      const root = wrapper.get('[data-testid="replay3d-root"]').element
      // 场景 canvas 上的一次真实点选：事件由 playbackScene 透传，target 既不是左车道也不是右车道，
      // 落位只能按 clientX 相对 workspace 的位置判定（这条路径曾引用未定义变量而在真实点击时抛错）。
      const canvas = document.createElement('canvas')
      root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 })
      onVehicleSelect(21, { target: canvas, clientX: 900 })
      await nextTick()
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Enemy')
      expect(wrapper.find('[data-testid="replay3d-details"]').exists()).toBe(true)
      onVehicleSelect(11, { target: canvas, clientX: 40 })
      await nextTick()
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Alpha')
      wrapper.unmount()
    })

    it('手机横屏 / 全屏横屏：Team 1 | Stage | Team 2 常驻两侧车道（不需要 Display → Roster）', async () => {
      layout.compact = true
      layout.portrait = false
      mockWebGL('webgl2')
      const wrapper = mountPane()
      await start(wrapper)
      const api = playback.api
      api.store.roster = roster
      await nextTick()
      const root = wrapper.get('.pb-root')
      expect(root.classes()).toEqual(expect.arrayContaining(['phone-form', 'roster-side']))
      expect(root.classes()).not.toContain('portrait-flow')
      // 两条物理车道直接可见：左 = Team 1，右 = Team 2
      expect(wrapper.get('[data-testid="replay3d-lane-left"]').find('.team1').exists()).toBe(true)
      expect(wrapper.get('[data-testid="replay3d-lane-right"]').find('.team2').exists()).toBe(true)
      expect(wrapper.get('.roster-surface').isVisible()).toBe(true)
      // 紧凑行：信息不减
      const row = wrapper.get('[data-testid="replay3d-lane-left"] .pl')
      expect(wrapper.get('[data-testid="replay3d-lane-left"] [data-test="pb-shell-roster"]').classes()).toContain('pb-roster-compact')
      expect(row.get('[data-test="pb-roster-tank"]').text()).toBe('Kranvagn')
      expect(row.get('[data-test="roster-hp"]').attributes('aria-label')).toBe('1800 / 1950')
      // 传输控件照常存在（名册与控件不互斥）
      expect(wrapper.find('.controls').exists()).toBe(true)
      wrapper.unmount()
      layout.compact = false
    })

    it('手机竖屏：纵向流（HUD / Stage / 传输控件 / 详情 inline / Team 1 / Team 2），没有浮层名册', async () => {
      layout.compact = true
      layout.portrait = true
      mockWebGL('webgl2')
      const wrapper = mountPane()
      await start(wrapper)
      const api = playback.api
      api.store.roster = roster
      await nextTick()
      const root = wrapper.get('.pb-root')
      expect(root.classes()).toContain('portrait-flow')
      expect(root.classes()).not.toContain('roster-side')
      // 名册直接在流里（不是 transient 浮层），行仍是完整信息
      expect(wrapper.get('.roster-surface').isVisible()).toBe(true)
      expect(wrapper.find('.roster-surface.transient').exists()).toBe(false)
      const rows = wrapper.findAll('.team-lane .pl')
      expect(rows).toHaveLength(3)
      expect(rows[0].get('[data-test="pb-roster-tank"]').text()).toBe('Kranvagn')
      expect(rows[0].get('[data-test="roster-hp"]').attributes('aria-label')).toBe('1800 / 1950')
      // 竖屏名册不是紧凑密度（纵向空间够用），也不做纵向铺满
      expect(wrapper.get('[data-test="pb-shell-roster"]').classes()).not.toContain('pb-roster-compact')
      expect(wrapper.get('[data-test="pb-shell-roster"]').classes()).not.toContain('pb-roster-fill')
      // 详情是同一个共享组件的 inline 呈现（经**场景点选**打开；名册点击=跟随）
      await openDetailsViaScene(roster.team1[0].eid)
      const details = wrapper.get('[data-testid="replay3d-details"]')
      expect(details.attributes('data-presentation')).toBe('inline')
      expect(details.find('[data-test="pb-sb-drag"]').exists()).toBe(false)
      wrapper.unmount()
      layout.compact = false
      layout.portrait = false
    })

    it('名册关闭（uiPrefs.showRoster=false）：两条车道消失；数据、选中、详情、跟随与播放都保留', async () => {
      layout.compact = true
      mockWebGL('webgl2')
      const wrapper = mountPane()
      await start(wrapper)
      const api = playback.api
      api.store.roster = roster
      api.store.time = 45
      await nextTick()
      playback.init.mock.calls.at(-1)[3].onVehicleSelect(11)
      await nextTick()
      await wrapper.get('[data-testid="display-toggle"]').trigger('click')
      await wrapper.get('[data-testid="disp-roster"]').setValue(false)
      expect(wrapper.find('.roster-surface').exists()).toBe(false)
      expect(wrapper.get('.pb-root').classes()).not.toContain('roster-side')
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Alpha')
      expect(api.store.roster).toEqual(roster)
      expect(api.store.time).toBe(45)
      expect(api.setFollow).toHaveBeenCalledExactlyOnceWith(11)
      await wrapper.get('[data-testid="disp-roster"]').setValue(true)
      expect(wrapper.get('[data-testid="replay3d-lane-left"] .pl').classes()).toContain('selected')
      expect(api.loadData).toHaveBeenCalledTimes(1)
      expect(playback.init).toHaveBeenCalledTimes(1)
      wrapper.unmount()
      layout.compact = false
    })

    it('详情 × 只关详情：选中保留、跟随 / 相机 / 时间不动；再点同一台或另一台重新打开同一个窗', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      api.store.time = 30
      await nextTick()
      const rowOf = (nick) => wrapper.findAll('.team-lane .pl').find((r) => r.text().includes(nick))
      await openDetailsViaScene(11)
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Alpha')
      await wrapper.get('[data-test="pb-sb-close"]').trigger('click')
      expect(wrapper.find('[data-testid="replay3d-details"]').exists()).toBe(false)
      expect(api.setFollow).toHaveBeenCalledExactlyOnceWith(11)   // 只来自点车，关详情不再调用
      expect(api.setCam).not.toHaveBeenCalled()
      expect(api.store.time).toBe(30)
      // 名册与详情互不影响：两条车道一直都在
      expect(wrapper.find('[data-testid="replay3d-lane-right"]').exists()).toBe(true)
      await openDetailsViaScene(11)
      expect(wrapper.findAll('[data-testid="replay3d-details"]')).toHaveLength(1)
      // 场景点另一台（Team 2）：同一个窗换内容，Team 2 车道仍在
      await openDetailsViaScene(21)
      expect(wrapper.findAll('[data-testid="replay3d-details"]')).toHaveLength(1)
      expect(wrapper.get('[data-test="pb-sb-player"]').text()).toBe('Enemy')
      expect(wrapper.find('[data-testid="replay3d-lane-right"]').exists()).toBe(true)
      expect(rowOf('Enemy').classes()).toContain('followed')
      // 场景点选不改名册高亮（selected 只由名册点击设置）
      expect(rowOf('Alpha').classes()).not.toContain('selected')
      wrapper.unmount()
    })

    it('selected 与 followed 是彼此独立的状态（可分别成立）', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      await nextTick()
      const rows = wrapper.findAll('.team-lane .pl')
      // 敌军队那行本来就是 followed（相机跟随），且未被选中
      const enemy = rows.find((r) => r.text().includes('Enemy'))
      expect(enemy.classes()).toContain('followed')
      expect(enemy.classes()).not.toContain('selected')
      // 选中另一行：选中变化不改变既有 followed 状态
      await rows[0].trigger('click')
      expect(rows[0].classes()).toContain('selected')
      expect(enemy.classes()).toContain('followed')
      wrapper.unmount()
    })

    it('详情面可关闭，且阵亡行显示击毁状态', async () => {
      mockWebGL('webgl2')
      const wrapper = mountPane()
      const api = playback.api
      api.store.hasData = true
      api.store.roster = roster
      await nextTick()
      await openDetailsViaScene(roster.team1[1].eid)   // Bravo（dead，eid=12）
      expect(wrapper.get('[data-test="pb-sb-state"]').text()).toBe('recon.map.playback.state_destroyed')
      await wrapper.get('[data-test="pb-sb-close"]').trigger('click')
      expect(wrapper.find('[data-testid="replay3d-details"]').exists()).toBe(false)
      wrapper.unmount()
    })
  })

  it('H closes an open Display panel and preserves the result for UI restoration', async () => {    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const { store } = playback.api
    store.banner = { outcome: 'win' }
    await nextTick()
    expect(wrapper.get('.banner').text()).toBe('agentReplay.banner_win')
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    await nextTick()
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="show-all-ui"]').exists()).toBe(true)
    expect(wrapper.find('.banner').exists()).toBe(false)
    expect(store.banner).toEqual({ outcome: 'win' })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'H', bubbles: true }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="display-toggle"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.banner').text()).toBe('agentReplay.banner_win')
    wrapper.unmount()
  })

  // 时间轴刻度 / 跳炮击 / 数字键骑乘（借鉴 blitzinfo）的面板接线：
  // 事件面来自 AgentPlaybackFacet（工作台状态 scenePlayback），刻度位置与跳炮击共用
  // utils/playbackShortcuts.js 纯函数；数字键冲突消解 = 自由飞行激活时归飞行速率。
  it('timeline ticks render from the facet and `,`/`.`/digits seek-jump and ride', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const { store } = playback.api
    store.hasData = true
    Object.assign(store, { startTime: 45, duration: 145, time: 110, friendlyTeam: 1, cam: 'follow' })
    store.roster = {
      team1: [
        { eid: 11, accountId: 11, team: 1, nick: 'A1', tank: 'T' },
        { eid: 12, accountId: 12, team: 1, nick: 'A2', tank: 'T' },
      ],
      team2: [{ eid: 21, accountId: 21, team: 2, nick: 'E1', tank: 'T' }],
      unknown: [],
    }
    const workspaceState = wrapper.props('playbackSession').getState(wrapper.props('file'))
    workspaceState.scenePlayback = {
      shots: [
        { t_fire: 50, shooter_eid: 11, is_author: true },
        { t_fire: 100, shooter_eid: 21, is_author: false },
        { t_fire: 120, shooter_eid: 12, is_author: false },
      ],
      kills: [{ t: 118, killer_eid: 11, victim_eid: 21, cause: 0 }],
    }
    await flush()
    expect(wrapper.findAll('.pb-tick-shot')).toHaveLength(3)
    expect(wrapper.findAll('.pb-tick-shot-highlight')).toHaveLength(1)   // is_author
    expect(wrapper.findAll('.pb-tick-kill')).toHaveLength(1)

    // `.` → time=110 之后最近的一发（120）；`,` → 之前最近的一发（100）
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period', key: '.', bubbles: true }))
    await nextTick()
    // 跳到目标发**之前**一小步：seekTo 用 firstIndexAfter(严格晚于 T) 定位游标，
    // 精确 t_fire 会把该发排除（炮线/炮声不出现）
    expect(playback.api.seekTime).toHaveBeenLastCalledWith(119.95)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Comma', key: ',', bubbles: true }))
    await nextTick()
    expect(playback.api.seekTime).toHaveBeenLastCalledWith(99.95)

    // 数字键骑乘（非飞行模式）：2 → 己方第 2 辆；Shift+1 → 敌方第 1 辆
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', key: '2', bubbles: true }))
    await nextTick()
    expect(playback.api.setFollow).toHaveBeenLastCalledWith(12)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', shiftKey: true, bubbles: true }))
    await nextTick()
    expect(playback.api.setFollow).toHaveBeenLastCalledWith(21)

    // 冲突消解：自由飞行激活（cam=free）→ 数字键归飞行速率，骑乘不触发
    store.cam = 'free'
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }))
    await nextTick()
    expect(playback.api.setFollow).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('collapses only the toolbar and preserves the session across UI and fullscreen transitions', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const { store } = playback.api
    Object.assign(store, { hasData: true, time: 42, playing: true, speed: 4, cam: 'follow' })
    await nextTick()
    store.roster = { team1: [{ eid: 7, accountId: 7, team: 1, nick: 'A', tank: 'T', hp: 1, maxHp: 2 }], team2: [], unknown: [] }
    await openDetailsViaScene(7)
    const selectedId = () => wrapper.getComponent({ name: 'VehicleDetailsPanel' }).props('selectedState').vehicle.accountId
    expect(selectedId()).toBe(7)
    const initCalls = playback.init.mock.calls.length
    const toggle = () => wrapper.get('[data-testid="replay3d-controls-toggle"]')
    expect(toggle().attributes('aria-expanded')).toBe('true')
    const content = wrapper.get('.controls-content')
    expect(toggle().attributes('aria-controls')).toBe(content.attributes('id'))
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await toggle().trigger('click')
    expect(toggle().attributes('aria-expanded')).toBe('false')
    expect(content.element.style.display).toBe('none')
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    expect(wrapper.find('.hud').exists()).toBe(true)
    Object.defineProperty(document, 'fullscreenElement', { value: wrapper.get('.pb-root').element, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    await nextTick()
    expect(toggle().attributes('aria-expanded')).toBe('false')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    await nextTick()
    expect(wrapper.find('[data-testid="replay3d-controls-toggle"]').exists()).toBe(false)
    await wrapper.get('[data-testid="show-all-ui"]').trigger('click')
    expect(toggle().attributes('aria-expanded')).toBe('false')
    await toggle().trigger('click')
    expect(wrapper.get('.controls-content').element.style.display).not.toBe('none')
    expect(selectedId()).toBe(7)
    expect(playback.init.mock.calls.length).toBe(initCalls)
    expect(store).toMatchObject({ time: 42, playing: true, speed: 4, cam: 'follow' })
    await toggle().trigger('click')
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    await wrapper.setProps({ file: mkFile('next.wotbreplay') })
    await start(wrapper)
    playback.api.store.hasData = true
    await nextTick()
    expect(toggle().attributes('aria-expanded')).toBe('true')
    wrapper.unmount()
  })

  it('button hide and H restore share the full UI transition', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    playback.api.store.banner = { outcome: 'lose' }
    await nextTick()
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await wrapper.get('[data-testid="hide-all-ui"]').trigger('click')
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    expect(wrapper.find('.banner').exists()).toBe(false)
    expect(wrapper.get('[data-testid="show-all-ui"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    await nextTick()
    expect(wrapper.get('.banner').text()).toBe('agentReplay.banner_lose')
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('隐藏全部 UI：HUD / 阵容 / 击杀流 / 标签全部让位，且永远可以恢复（按钮或 H 键）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.killfeed = [{ id: 1, kill: true, killer: 'K', victim: 'V' }]
    store.roster = {
      team1: [{ eid: 1, team: 1, nick: 'A', tank: 'T', hp: 1, maxHp: 2, dead: false, followed: false }],
      team2: [], unknown: [],
    }
    await nextTick()
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await nextTick()
    await wrapper.get('[data-testid="hide-all-ui"]').trigger('click')
    await nextTick()

    expect(wrapper.find('.topbar').exists()).toBe(false)
    expect(wrapper.find('.killfeed').exists()).toBe(false)
    expect(wrapper.find('.team-lane').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="display-toggle"]').exists()).toBe(false)
    // 标签整层关掉（场景侧 enabled:false）
    expect(playback.api.setLabelPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))

    // 常驻恢复入口
    const restore = wrapper.get('[data-testid="show-all-ui"]')
    await restore.trigger('click')
    await nextTick()
    expect(wrapper.find('.topbar').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)

    // H 键等效（window 级监听）
    const pane = wrapper.findComponent(paneComponent())
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(false)

    // 输入控件聚焦时不劫持：happy-dom 的合成 KeyboardEvent 不带 target，
    // 所以直接按真实形状（target = INPUT）驱动同一个处理函数。
    const keyEvent = (target, key = 'h') => ({ key, target, preventDefault: vi.fn() })
    const before = wrapper.find('[data-testid="show-all-ui"]').exists()
    pane.vm.onUiToggleKeydown(keyEvent({ tagName: 'INPUT', isContentEditable: false }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(before)
    pane.vm.onUiToggleKeydown(keyEvent({ tagName: 'BUTTON', isContentEditable: false }))
    pane.vm.onUiToggleKeydown(keyEvent({ tagName: 'DIV', isContentEditable: true }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(before)
    // 普通元素上仍然生效
    pane.vm.onUiToggleKeydown(keyEvent({ tagName: 'DIV', isContentEditable: false }))
    await nextTick()
    expect(wrapper.find('[data-testid="show-all-ui"]').exists()).toBe(!before)
    wrapper.unmount()
  })
})
