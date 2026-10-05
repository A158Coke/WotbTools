// 实时回放的响应式 UI 状态：scene（playbackScene.js，命令式 three.js 内核）每 tick 写入，
// Vue 面板组件只读渲染；控件事件回调 scene 方法。字段与旧版 DOM 触点一一对应。
import { reactive } from 'vue'

export function createPlaybackStore() {
  return reactive({
    // loader 弹层
    filePath: '',
    playbackSession: null, // Workspace canonical result shared with 2D / Details
    loading: false,
    assetStage: false,   // 进入场景前正在获取地图/地形/地表/场景资产（WotBTools：资产就绪才进场）
    assetProgress: null, // 资产阶段进度 0–1（loadProgress 聚合）；null = 尚未登记任何资产
    err: '',
    qualityKey: '',
    qualityLabel: '',
    // 顶栏
    mapName: '',
    mapKey: null, // 资产面地图 key（与三语地图名表 map_names.json 同一套 key）
    // 顶栏比分：已是阵营视角（perspectiveScore：己方 = 录像者一方），与两侧血条同视角
    scoreFriend: 0,
    scoreEnemy: 0,
    // 顶栏双方总血量（teamHpTotals：按全队 max_hp 汇总；未知阵营不计入任一方）
    hpFriend: 0, hpFriendMax: 0, hpEnemy: 0, hpEnemyMax: 0,
    hpFriendPct: 100, hpEnemyPct: 100,
    // 单基地目标（攻防/遭遇战）：objective 存在性与进度分开——0 与「未发生」不同
    // 争霸实时点数（上限 1000）：null = 该场无点数广播（非争霸）
    pointsFriend: null,
    pointsEnemy: null,
    // 基地视图模型（utils/baseStatus.js baseView；争霸 A–D 与单基地）：顶部基地状态条直接渲染
    baseViews: [],
    // 控制条
    playing: false,
    speed: 1, // 与 2D 统一默认 1×（usePlaybackTransport.DEFAULT_PLAYBACK_SPEED）
    time: 0,
    // 战斗时间轴 [startTime, duration]（绝对秒）由场景引擎发布：开战 → 结束，与 2D 同一个 0（canonical clock 优先）；
    // 无法确定开战时刻时退回数据范围（t_start 含准备阶段）。面板的播放条 / 顶栏计时 / Details 都以 startTime 为原点
    startTime: 0,
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
    // 名册按**物理队伍**分组（team 1 / team 2 / 未识别），未知阵营（team=0）进 unknown 中性组
    // ——绝不污染 team1（旧 hack `team!==2→team1`）。
    // 身份（eid/team/nick/tank）只在会话开始时建一次；运行时状态
    // （hp/maxHp/dead/followed）由 playbackScene.updateRoster 按当前回放时刻投影，
    // 见 scene/rosterState.js。呈现层结合 friendlyTeam 取 Recorder 视角颜色，内核不下发颜色。
    friendlyTeam: null, // Authoritative Recorder team; unknown never implies Team 1.
    roster: { team1: [], team2: [], unknown: [] },
    hasData: false,
  })
}
