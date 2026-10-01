// 实时回放的响应式 UI 状态：scene（playbackScene.js，命令式 three.js 内核）每 tick 写入，
// Vue 面板组件只读渲染；控件事件回调 scene 方法。字段与旧版 DOM 触点一一对应。
import { reactive } from 'vue'

export function createPlaybackStore() {
  return reactive({
    // loader 弹层
    filePath: '',
    loading: false,
    assetStage: false,   // 进入场景前正在获取地图/地形/地表/场景资产（WotBTools：资产就绪才进场）
    assetProgress: null, // 资产阶段进度 0–1（loadProgress 聚合）；null = 尚未登记任何资产
    err: '',
    qualityKey: '',
    qualityLabel: '',
    // 顶栏
    mapName: '',
    timer: '--:--',
    score1: 0,
    score2: 0,
    // 单基地目标（攻防/遭遇战）：objective 存在性与进度分开——0 与「未发生」不同
    // 争霸实时点数（上限 1000）：null = 该场无点数广播（非争霸）
    pointsFriend: null,
    pointsEnemy: null,
    assaultObjective: false,
    assaultProgress: null,
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
    // team 未知（0）的车进 unknown 中性组——绝不污染 team1（旧 hack `team!==2→team1`）
    roster: { team1: [], team2: [], unknown: [] }, // { eid, dot, nick, tank, frac, dead, followed, isAuthor }
    hasData: false,
  })
}
