/** Agent 回放数据契约 —— 时序能力类型（PlaybackData 列式网格与事件族；DTO 冻结）。
 *  拆分自 agent-replay-facets.ts；公共入口仍为 `../agent-replay-facets.ts`。 */


// ---------- 时序能力：PlaybackData（contract v2：+Supremacy/点数/瞄准帧；版本显式门禁） ----------

export interface AgentPlaybackMeta {
  map_id: number
  map_name: string
  winner_team: number
  friendly_team: number
  author_eid: number
  t_start: number
  samples: number
  duration: number
}

/**
 * 位姿关键帧折线（上游 `pose_kf`，**additive**：旧产物缺省）。
 *
 * 车辆路径 = 客户端 60Hz 渲染路径的**折点**序列（facet 层走廊拟合）：
 * 在相邻关键帧间**线性插值**即复现客户端画面，含「保持-跳变」阶梯（滤波器刚进 AoI 数秒内
 * 的输出形态）。10Hz 网格重采样会把该阶梯混叠成速度摆动，故渲染以本列为准。
 * 车辆 `yaw` 为解卷绕连续域（与 `hull_yaw` 网格同域）；端点外按端点**保持**。
 * 独立炮塔复用列式形状，但来自 Type5 初帧 / Type10 原始实体采样；覆盖段内插值，段间不可插值。
 */
export interface AgentPoseKeyframes {
  /** 关键帧时刻（秒，回放时钟域，升序） */
  t: number[]
  /** [x,y,z] × t.length（回放世界系，米） */
  pos: number[]
  yaw: number[]
  pitch: number[]
  /** 独立炮塔横滚（弧度）；车辆关键帧旧形状缺省 */
  roll?: number[]
}

/** 独立炮塔实体：归属只来自 Type5 class 8 属性；不是按血量/空间距离推断的特效。 */
export interface AgentDetachedTurretTrack {
  /** 独立实体 ID（正 u32；与车辆实体不同） */
  eid: number
  /** 同一 PlaybackData 中的权威所属车辆实体 ID */
  vehicle_eid: number
  /** AoI 覆盖闭区间 [start,end,...]（raw 秒）；区间外位姿未知 */
  coverage: number[]
  /** Type5 开段位姿与 Type10 真实世界位姿；每段首帧必须位于该段起点，roll 必填 */
  pose_kf: AgentPoseKeyframes & { roll: number[] }
}

/** 车辆全场时间线（列式网格；含花名册语义：nickname/tank_id/team/is_author） */
export interface AgentVehicleTrack {
  eid: number
  account_id: number
  nickname: string
  tank_id: number
  tank_name: string
  team: number
  is_author: boolean
  max_hp: number
  /** [x,y,z] × samples，0.01m 舍入 */
  pos: number[]
  hull_yaw: number[]
  hull_pitch: number[]
  /**
   * 车体侧倾（弧度；上游 2026-10-03 起产出，**additive**：旧产物缺省 → 消费端按 0 = 水平）。
   * 与 `hull_pitch` 不同源：俯仰取自渲染滤波输出，侧倾取**原始 type=10 volatile 采样**的
   * 最近邻（滤波层不输出侧倾）。上游规则见 `crates/replay-core/src/replay/playback.rs`
   * 的 `roll_nearest`（段内不插值、不跨 AoI 断段编造中间姿态）。
   */
  hull_roll?: number[]
  turret_yaw: number[]
  gun_pitch: number[]
  hp: Array<[number, number]>
  death_t: number | null
  killer_eid: number
  /**
   * 全部死亡时刻（升序；`death_times[0] == death_t`，**上游 2026-10-15 起产出，additive**）。
   * **仅该车死亡 ≥2 次（复活模式，如爆燃）才输出**；单死/无死回放字段缺省。
   * 缺省 = death_t 已完整表达生命史（死亡终态语义）。
   */
  death_times?: number[]
  /**
   * 复活时刻（升序；**上游 2026-10-15 起产出，additive，仅非空才输出**）。
   * 生命状态重建：death_t 起 DESTROYED，至首个 ≥ 该时刻的复活点回 ALIVE，与后续死亡交替。
   * 字段缺省 = 无复活证据 → 死亡终态（fail-closed，行为与既往一致）。上游契约见
   * `crates/replay-core/src/replay/playback.rs` VehicleTrack。
   */
  resurrection_times?: number[]
  shell_ids: number[]
  turret_index: number | null
  gun_index: number | null
  /**
   * 实际搭载配置在坦克数据 `configs[]` 数组中的下标（与 shots 的 `shooter_config_idx`
   * 同域；上游 2026-10-06 起产出，**additive**：旧产物缺省）。缺省 = configs 唯一或
   * 证据链未命中 → 消费端回退顶级配置。
   */
  config_idx?: number | null
  /**
   * 实际搭载主炮的弹夹容量（`configs[config_idx].burst_size` 原值，**0 = 单发**；
   * 上游 2026-10-06 起产出，**additive**：旧产物缺省）。装填条弹容 N 的唯一权威取值——
   * 多炮坦克各炮弹容不同，禁止跨配置取最大 / 用剩余弹数+1 推断（上游
   * docs/wotbtools-cross-reference.md §六「弹容 N 裁决」）。缺省 → 消费端按单发（1），不猜。
   */
  burst_size?: number | null
  /**
   * comp blob（ARENA_INFO subtype 1）透传的炮塔/主炮模块局部 id（module_id>>8；
   * 上游 2026-10-06 起产出，**additive**）。**纯回放证据**：客户端（WASM）路径用它
   * 联表 `configs[].turret_local`/`gun_local` 钉定实际搭载配置
   * （`reloadBar.resolveMountedConfig` 证据 0）。缺省 = 该场无 comp 广播。
   */
  turret_local?: number | null
  gun_local?: number | null
  coverage: number[]
  /**
   * 位姿关键帧折线（渲染位姿的精确表示；缺省 = 旧产物 → 消费端回退 10Hz 网格插值）。
   * 覆盖 `pos`/`hull_yaw`/`hull_pitch` 三列；`turret_yaw`/`gun_pitch`/`hull_roll` 仍只有网格列。
   */
  pose_kf?: AgentPoseKeyframes
  /**
   * Type5 战斗装载描述符（6 × 14 字节：`[wire, state, ...12 payload]`；前 3 = consumable、
   * 后 3 = provision）。无 0A06/0B09 framing 的车辆缺省。
   */
  loadout_items?: number[][]
  /** Type5 装备 9 字节（equipment id 原值，位置序）；与 loadout_items 同缺省 */
  equipment?: number[]
  /**
   * Type5 装载解码视图（上游 v0.4.17 additive）：3 消耗品 + 0..3 给养 + 模式额外能力 +
   * equipment/equipment_ids。缺省 = 旧产物（消费端回退 loadout_items）。
   */
  loadout?: AgentVehicleLoadout | null
}

/** Type5 单条 14B 描述符解码视图（raw 恒保留）。 */
export interface AgentLoadoutItem {
  index: number
  kind: 'consumable' | 'provision' | 'ability'
  wire_code: number
  state: number
  payload_raw: number[]
  logical_id?: string | null
}

export interface AgentVehicleLoadout {
  equipment: number[]
  equipment_count: number
  equipment_ids: number[]
  items: number[][]
  consumables: AgentLoadoutItem[]
  abilities: AgentLoadoutItem[]
  provisions: AgentLoadoutItem[]
}

/** Type32 消耗品生命周期（state：1=INITIALIZED 2=ACTIVATED 3=ACTIVE_ENDED_OR_COOLDOWN 255=TEARDOWN） */
export interface AgentConsumableEvent {
  clock: number
  eid: number
  wire_code: number
  /** 已证逻辑标识（v0.4.17 additive；旧产物缺省 → 回退前端 wire 表） */
  logical_item_id?: string | null
  state: number
  /** 语义状态名（v0.4.17 additive；与 canonical 名称一致） */
  state_name?: string
  /** state2=激活持续秒 / state3=冷却秒（v0.4.17 additive） */
  duration_s?: number | null
  /** clock + duration_s（回放时钟，v0.4.17 additive） */
  ends_at?: number | null
  /** 该 (eid, wire) 此前是否激活过（v0.4.17 additive） */
  ever_activated?: boolean
  /** loadout 消耗品槽位 0..2（v0.4.17 additive；模式能力/未知为 null/缺省） */
  slot?: number | null
  body_clock: number
  param: number
}

/** method16 模块/乘员状态（recorder-visible telemetry；仅作者车辆） */
export interface AgentModuleCrewState {
  clock: number
  vehicle_eid: number
  state_code: number
  component_code: number
  /** snake_case 组件名（left_track / engine / commander …）；未知为 "unknown" */
  component: string
  /** snake_case 状态（damaged_degraded / critical_disabled / auto_repaired_to_damaged / full_repaired_clear …） */
  state: string
  related_eid: number
}

/** Type5 配件串物化（上游 replay-core VehicleEquipment；additive，缺省 = 该场无 0B framing 证据）。 */
export interface AgentVehicleEquipment {
  /** 携带校准弹（id 103） */
  calibrated_shells?: boolean
  /** 携带强化装甲（id 110） */
  enhanced_armor?: boolean
  /** 携带改进型垂直稳定器（id 122；炮管仰角 +4°/俯角 +3°，仅 true 时序列化） */
  improved_pitch_limits?: boolean
  /** 九槽配件 id 原值（0=空槽垫底、空槽省略；**位置不承载槽位语义**，反解只能按 id 对号预设） */
  raw?: number[]
}

export interface AgentPlaybackShot {
  t_fire: number
  shooter_eid: number
  target_eid?: number
  from: [number, number, number]
  to: [number, number, number]
  /** 飞行时长（秒）：折线各段之和（直射弹 = |to−from| / |launch_velocity|） */
  flight_secs: number
  /**
   * 弹道折线中间点（跳弹/穿透出射点，按飞行顺序；**additive**：旧产物缺省 → 直射单段）。
   * 上游 = 同 (shooter, shotId) 的后续 method29 起点（服务器在命中/跳弹时刻重播续段）。
   */
  via?: [number, number, number][]
  /** 各段时长（秒）：段 0 = from→via[0]，…，末段 = …→to；`len == via.len() + 1` */
  leg_secs?: number[]
  shell_speed: number
  hit: boolean
  ricochet: boolean
  /** 0=无 1=未击穿 2=间隙止 3=有伤害 4=履带/模块 255=未获取 */
  game_hit_result: number
  damage: number
  is_kill: boolean
  is_author: boolean
  shell_kind?: string
  shooter_name?: string
  target_name?: string
}

export interface AgentKillEvent {
  t: number
  killer_eid: number
  victim_eid: number
  /** 0=炮弹 1=火焰 2=撞击 3=世界/环境 5=溺水 */
  cause: number
  assister_eid?: number
  death_reason?: number
}

export interface AgentAoiPresence {
  eid: number
  t_in: number
  t_out?: number
  /**
   * 开段 Type5 物化快照的原始 HP u16（上游 v0.3.5；仅战斗车辆）。每次重入各自携带——
   * 隐藏期间的掉血在重入时兑现。原样未分类：0 / ≥0xFF00 哨兵由消费方按 HpRawState 口径处理。
   */
  hp_raw?: number
}

/** Supremacy 基地状态迁移（上游 v0.2.0 wrapper12/root11 PROVEN；sparse 重建产物） */
export interface AgentSupremacyBaseTransition {
  clock: number
  /** 0..3 = A..D */
  base_id: number
  /**
   * 上游为 `Option<u8>` 且未加 skip_serializing_if —— 空 canonical 态（无主/未占领/
   * 无进度）序列化为**显式 null**，故必须建模为 `number | null`：`undefined` 表示
   * 字段本身缺失（老产物），`null` 表示"该维度为空"。渲染侧不得把 null 当作
   * 有值的 owner/capturer/progress。
   */
  owner_team?: number | null
  capturing_team?: number | null
  capture_progress?: number | null
}

/** Supremacy 实时点数采样（wrapper13/root12；仅真实广播，消费取 ≤t 最后值） */
export interface AgentSupremacyPointsSample {
  clock: number
  team: number
  points: number
}

/**
 * 单基地占领进度迁移（上游 v0.3.1 wrapper8/root8；攻防战/遭遇战共用载体）。
 * 判据为 `field2==1 && field3 存在`（0..100）——**不锁 field1**：真实回放中携带进度的族
 * 会在 field1=1/2 之间切换（Yukon 两族交替、Malinovka 仅 2、遭遇战仅 1）。
 * 不施加单调性：回落/重置原样保留。
 */
export interface AgentAssaultBaseTransition {
  clock: number
  /** 占领进度 0..100 */
  progress: number
}

/**
 * arena subtype 15/16/17 原始装填事件（仅本方；null = 上游字段缺失）。
 *
 * `duration_s` 是 producer 的**原始透传**（原始 f3 秒数），不是倒计时，也**不保证为正**：
 * 时长变更（phase=4）会给出负 finite 值。它是原始事实，是否可解释成定时相位由消费层决定。
 */
export interface AgentReloadEvent {
  clock: number
  eid: number
  phase: number
  duration_s: number | null
  count: number | null
}

/** method 35 当前生效完整装填时长（仅本方） */
export interface AgentReloadEffectiveEvent {
  clock: number
  eid: number
  duration_s: number
}

/** 动态装甲 armorsStates 轨道（列式；上游 additive，skip-when-empty——静态车缺省）。
 *  状态语义 = 车辆 XML `<armorsStatesController>` 声明（上游 data/armor_states.json，
 *  前端 vendored 于 `src/data/armorStates.js`）；值 ∉ 声明集的更新由消费端门控丢弃。 */
export interface AgentArmorStateTrack {
  eid: number
  t: number[]
  state: number[]
}

/** 作者当前弹种变更事件（method 0x07 服务器确认；shell_id 与回放 shell 表同域） */
export interface AgentAuthorShellEvent {
  t: number
  shell_id: number
}

/** 可破坏地形区域实体（100m 格子锚点；游戏场景系 x/z） */
export interface AgentDestructibleArea {
  eid: number
  x: number
  z: number
}

/** 可破坏事件 envelope（prop：1=fragiles、2=柱状物、3=树倒；fall_dir = 8 位倒向角，LSB=1.40625°） */
export interface AgentDestructibleEvent {
  clock: number; area_eid: number; prop: number; slot: number
  fall_dir: number; body_len: number; args: number[]
}

export interface AgentPlaybackFacet {
  version: number
  meta: AgentPlaybackMeta
  vehicles: AgentVehicleTrack[]
  shots: AgentPlaybackShot[]
  kills: AgentKillEvent[]
  periods: Array<{ clock: number; period: number; remaining_s: number; duration_s: number }>
  visibility: AgentAoiPresence[]
  /** contract v2 新能力（skip-when-empty：非争霸场缺省） */
  supremacy_bases?: AgentSupremacyBaseTransition[]
  supremacy_points?: AgentSupremacyPointsSample[]
  /**
   * 单基地目标存在性（上游 v0.3.1）——**独立于是否已有占领进度**。判据为 wrapper8/root8
   * 目标族（`field2==1`、`field1 ∈ {1,2}`）**出现过即真**，含只发裸初始化对
   * `1=1,2=1` + `1=2,2=1` 的场次（2026-10-03 判定修正：此前"须超出初始化对"比契约更严，
   * 把"有目标但全程未占领"的场次——实测 10v10 的 Mayan Ruins——整场目标圈压掉了）。
   * 缺省/ false = 无目标族广播。单基地与争霸互斥（wrapper8 vs wrapper12）。
   * 详情见上游 `docs/replay-contract-v2-supremacy-type39.md` §5.1。
   */
  assault_objective_present?: boolean
  /** 单基地占领进度时间线（skip-when-empty：非单基地场次缺省） */
  assault_bases?: AgentAssaultBaseTransition[]
  /** Type32 消耗品生命周期（全员，AoI 内可见部分） */
  consumables?: AgentConsumableEvent[]
  /** method16 模块/乘员状态（recorder-only） */
  module_crew_states?: AgentModuleCrewState[]
  /** v0.3.9：arena subtype 15/16/17 原始装填时间线（仅本方） */
  reloads?: AgentReloadEvent[]
  /** v0.3.9：method 35 当前生效完整装填时长（仅本方） */
  reload_effective?: AgentReloadEffectiveEvent[]
  /**
   * 作者当前弹种时间线（additive）：切换即生效，无 selected/loaded 分离。
   * 归属止于作者首次死亡，之后可能是被观战车辆。缺省 = 当前弹种未知。
   */
  author_shell_timeline?: AgentAuthorShellEvent[]
  /** 动态装甲 armorsStates 时间线（上游待发版 additive；仅 6 辆声明车非空，静态车缺省） */
  armor_states?: AgentArmorStateTrack[]
  /** 独立炮塔实体轨迹（additive）；缺省/空数组 = 没有可用的炮塔事实 */
  detached_turrets?: AgentDetachedTurretTrack[]
  /** 可破坏地形（上游 2026-10-05 起 additive；旧产物缺失 = 特性禁用） */
  destructible_areas?: AgentDestructibleArea[]
  destructible_events?: AgentDestructibleEvent[]
  /** 聊天频道表（上游 v0.5.0 additive；Avatar method 0x2f pickle，开局状态非时序事件） */
  chat_channels?: AgentChatChannel[]
  /** 聊天文本消息（上游 v0.5.0 additive；Avatar method 0x2b，形状门禁产物）。
   *  `tag`/`seq` 原样透传、语义未定（单样本 provenance）——消费方不得命名/猜测。 */
  chat_messages?: AgentChatMessageEvent[]
  /** 单发通知（上游 v0.5.0 additive；Avatar method 0x12）。`code` 语义未定，原样透传。 */
  notifications?: AgentNotificationEvent[]
  /** 聊天域动作事件（上游 v0.5.1 additive；Avatar method 0x2f 全类型）——战斗聊天正文、
   *  快捷指令、成员进出、频道建立。**战斗聊天正文以此为准**（0x2b 是另域）。 */
  chat_events?: AgentChatEvent[]
  /** 逐模块损伤（上游 v0.5.1 additive；method38 组件 token，作者路径） */
  module_damage_events?: AgentModuleDamageEvent[]
  /** 逐次掉血事件（上游 v0.5.2 additive；method1 血量链）——blitzinfo ev-damage 等价物 */
  damage_events?: AgentDamageEvent[]
  /** 战场快捷标记（上游 v0.5.4 additive；Avatar method 0x2e）——战斗日志的地图标记行 */
  markers?: AgentBattleMarkerEvent[]
}

/** 掉血事件：damage = prev_hp − hp（0 = 该事件未掉血，如治疗/复位） */
export interface AgentDamageEvent {
  t: number
  victim_eid: number
  damage: number
  hp: number
  /** 伤害来源（0 = 未归属/环境） */
  source_eid: number
  /** 与 kills.cause 同域：0=炮弹 1=火焰 2=撞击 3=世界 5=溺水 */
  cause: number
}

/** 0x2f 动作事件类别（未命名类别 = other，raw_type 原样保留） */
export type AgentChatEventKind = 'message' | 'command' | 'join' | 'leave' | 'channel_created' | 'other'

export interface AgentChatEvent {
  t: number
  kind: AgentChatEventKind
  /** 原始事件码（未命名类别的唯一证据） */
  raw_type: number
  /** 频道句柄（与 chat_channels[].id 同域） */
  channel: number
  sender: string
  /** 聊天正文（仅 kind=message） */
  text?: string
  /** 快捷指令码（仅 kind=command；语义未闭合，原样透传） */
  command?: number
  /** 指令目标（仅 kind=command）：attack_enemy→accountId；attention_to_cell→扇区号；0 = 无目标 */
  target?: number
  /** 指令语义名（上游 v0.5.3；客户端权威表）。缺省 = 未映射 id（raw 保留） */
  command_name?: string
}

/** 逐模块损伤（method38 组件 token；rawState 0=无新负面 1=受损 2=critical） */
export interface AgentModuleDamageEvent {
  clock: number
  victim_eid: number
  component_code: number
  component: string
  state_code: number
  state: 'damaged' | 'critical' | 'no_change' | 'unknown'
}

/** 聊天频道表条目（pickle 字典已证实子集；缺键省略。见上游 docs/replay-chat-events.md） */
export interface AgentChatChannel {
  channel_name: string
  id: number
  db_id?: number
  owner?: number
  flags?: number
  is_system?: boolean
  is_read_only?: boolean
  is_secured?: boolean
}

/** 聊天文本消息（发送者昵称不在包内——UI 需另行联表或留空） */
export interface AgentChatMessageEvent {
  t: number
  tag: number
  seq: number
  text: string
}

/** 单发通知（观测 code：11515/26109；语义未定） */
export interface AgentNotificationEvent {
  t: number
  subject: number
  code: number
}

/**
 * 战场快捷标记（上游 v0.5.4 additive；Avatar method 0x2e）。
 * `marker_type` 1=moving_here（`at` 世界坐标）/ 4=attack（`target_eid`）/
 * 5=ally_retreat（`target_eid`）；其余类型只保留 `marker_type`，消费方不得命名。
 */
export interface AgentBattleMarkerEvent {
  t: number
  /** 发送者实体 id（与 vehicles[].eid 同域；不是信封 Avatar eid） */
  entity_id: number
  /** 发送者账号 id（与 vehicles[].account_id 同域） */
  account_id: number
  marker_type: number
  at?: [number, number, number]
  target_eid?: number
}
