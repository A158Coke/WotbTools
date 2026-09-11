import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'

// 与 src/main.js 完全相同的样式加载顺序：三档 form + fullscreen contract 的相对顺序
// 本身就是被验证的契约之一，fixture 不得另起一套顺序。
import '../../src/styles/tokens.css'
import '../../src/styles/showcase.css'
import '../../src/styles/showcase-workspaces.css'
import '../../src/styles/showcase-pages.css'
import '../../src/styles/showcase-rankings.css'
import '../../src/styles/showcase-backgrounds.css'
import '../../src/styles/showcase-backgrounds-v3.css'
import '../../src/styles/showcase-cohesion.css'
import '../../src/styles/showcase-regressions.css'
import '../../src/styles/app-shell.css'
import '../../src/styles/playback-overlap-ux.css'
import '../../src/styles/playback-shared.css'
import '../../src/styles/playback-pc.css'
import '../../src/styles/playback-tablet.css'
import '../../src/styles/playback-mobile.css'
import '../../src/styles/playback-mobile-fullscreen.css'
import '../../src/styles/playback-fullscreen-form-contract.css'
import '../../src/styles/classic-profile.css'

import { messages } from '../../src/locales/messages.js'
import BattlePlayback from '../../src/components/BattlePlayback.vue'
import { makeBattlePlaybackDataset } from '../../src/test/playbackV2TestUtil.js'

/**
 * `?view=playback-qa` 之外的第二条浏览器级入口：以固定 dataset 直接挂载**生产**
 * `BattlePlayback`，用于验证播放控件在真实浏览器/真实设备形态下可交互。
 * `?duration=<sec>` 指定时间线长度；`duration=0` 用来复现「duration<=0 时播放按钮
 * 看起来可用但 silent no-op」这一类不可用态。
 */
const params = new URLSearchParams(window.location.search)
const dataset = makeBattlePlaybackDataset()
if (params.has('duration')) dataset.durationSec = Number(params.get('duration'))

const i18n = createI18n({
  locale: 'zh',
  fallbackLocale: 'en',
  messages,
})

const Root = {
  name: 'PlaybackControlsFixture',
  render: () => h(BattlePlayback, { playbackV2: dataset }),
}

createApp(Root).use(i18n).mount('#app')
