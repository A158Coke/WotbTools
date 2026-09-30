// 实时回放的响应式 UI 状态：scene（playbackScene.js，命令式 three.js 内核）每 tick 写入，
// Vue 面板组件只读渲染；控件事件回调 scene 方法。字段与旧版 DOM 触点一一对应。
import { reactive } from 'vue'

export function createPlaybackStore() {
  return reactive({
    // loader 弹层
    filePath: '',
    loading: false,
    assetStage: false,   // 进入场景前正在获取地图/地形/地表/场景资产（WotBTools：资产就绪才进场）
    err: '',
    qualityKey: '',
    qualityLabel: '',
    // 顶栏
    mapName: '',
    timer: '--:--',
    score1: 0,
    score2: 0,
    // 控制条
    playing: false,
    speed: 2,
    time: 0,
    duration: 0,
    seekFrac: 0,
    seeking: false, // 用户拖动进度条期间场景不回写
    cam: 'free',
    glbOn: false,
    glbAllowed: true,
    labelsOn: true,
    // 覆盖层
    banner: null, // { text, color }
    killfeed: [], // { id, text }
    roster: { team1: [], team2: [] }, // { eid, dot, nick, tank, frac, dead, followed, isAuthor }
    hasData: false,
  })
}
