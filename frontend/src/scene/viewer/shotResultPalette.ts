/**
 * 装甲判定结果语义色（唯一 owner）。
 *
 * 标定色阶来自设计语言/热力图既有语义（固定红→橙→黄→绿，见 docs/frontend/ui-system.md
 * “热力图概率色带固定红→橙→黄→绿”），本模块把它显式化成结果角色（击穿/可能/跳弹/
 * 溅射/挡下/未到达/错误）：
 *
 * - 卡片 / 图例消费 CSS 别名 `--green/--yellow/--orange/--purple/--red`（`.armor-view` 内指向
 *   设计语言语义 token，已按 WCAG 校准）。跳弹用 `--purple`（热力图跳弹高亮
 *   `vec3(1,0,1)` 的同色相紫），HE 溅射仍用 warning/danger 派生的 `--orange`。
 * - 3D fxScene 消费同色相的**受控亮变体**：细长、高动态的射线/圆点需要字面亮度，
 *   且必须 `toneMapped:false` 直出字面色（与 playback/palette.ts 的 TRACER_* 同一模式：
 *   车辆 tint 用压得住的深色，炮线/标记用亮色）。亮变体只提高明度/彩度，色相与
 *   token 偏差 ≤10°，由 shotResultPalette.test.ts 锁定。
 *
 * 热力图 shader 的色带不在此模块内，也不随本模块修改；跳弹紫只对齐它已有的
 * 高亮色相（画面语义，不是新色阶）。
 */

/** 判定结果角色：卡片、射线、层点、命中点、图例共用；UNREACHED 只用于层点。 */
export type ShotResultRole = 'PENETRATION' | 'MAY_PENETRATE' | 'RICOCHET' | 'SPLASH' | 'BLOCKED' | 'UNREACHED' | 'ERROR'

/** 角色 → 卡片/图例 CSS 变量（`.armor-view` 内定义）。 */
export const RESULT_CSS_VAR: Readonly<Record<ShotResultRole, string>> = Object.freeze({
  PENETRATION: 'var(--green)',
  MAY_PENETRATE: 'var(--yellow)',
  RICOCHET: 'var(--purple)',
  SPLASH: 'var(--orange)',
  BLOCKED: 'var(--red)',
  UNREACHED: 'var(--muted)',
  ERROR: 'var(--red)',
})

/** 热力图跳弹高亮色相（`vec3(1.0, 0.0, 1.0)` = #ff00ff，300°），跳弹角色对齐它。 */
export const RICOCHET_HEATMAP_HUE_COLOR = 0xff00ff

/**
 * 角色 → 3D 场景亮变体（sRGB hex）。
 *
 * 色相与 token 对齐：success #5cc280（≈141°）/ warning #f5ca76（≈40°）/
 * danger #f2786d（≈5°）；跳弹紫与热力图高亮同色相（#ff00ff，300°），HE 溅射
 * 沿用 warning/danger 之间的橙（≈29°）。只提高明度/彩度，不改变语义。
 */
export const SCENE_RESULT_COLORS: Readonly<Record<ShotResultRole, number>> = Object.freeze({
  PENETRATION: 0x3ee08a,
  MAY_PENETRATE: 0xffd24a,
  RICOCHET: 0xff6bff,
  SPLASH: 0xff9b3d,
  BLOCKED: 0xff5f52,
  UNREACHED: 0x9aa3ad,
  ERROR: 0xff5f52,
})

/** 3D 覆盖物尺寸/描边（屏幕空间 CSS px）。 */
export const OVERLAY_METRICS = Object.freeze({
  /** 射线核心线宽（CSS px，LineMaterial worldUnits:false）。 */
  rayWidthPx: 2,
  /** 射线深色描边总宽（核心两侧各 1px）。 */
  rayHaloWidthPx: 4,
  rayHaloColor: 0x05070a,
  rayHaloOpacity: 0.5,
  /** 层点总直径（含 1.5px 深色描边）。 */
  dotSizePx: 7,
  /** 命中点总直径。 */
  markerSizePx: 9,
  /** 命中点等待判定时的中性色（结果返回后改为结果亮变体）。 */
  markerPendingColor: 0xf5f5f5,
  /** 轨迹/层点渲染顺序：溅射球壳 995 → 描边 996 → 核心 997 → 命中点 999。 */
  haloRenderOrder: 996,
  coreRenderOrder: 997,
  markerRenderOrder: 999,
})

/**
 * 射击复现调试标注调色板（数值与 agent-theme-css.test.js 的 MARKER_COLOR_ALLOWLIST
 * 一一对应；图例文本与 3D 材质共用本表，避免两处 hex 漂移）。
 */
export const ANNOTATION_COLORS = Object.freeze({
  launch: 0xff6622,       // LaunchPoint / 倒车
  velocity: 0x00ccff,     // 速度向量 / 位移方向 / tick 路径
  chord: 0x00ff00,        // 弹道弦
  endpoint: 0xffcc00,     // 落点 / 服务器终点
  bounce: 0xffaa00,       // 弹跳点
  impact: 0xff2222,       // 弹着点
  shooterAnchor: 0x00aaff,// 基准点·射手
  victimAnchor: 0x00ffcc, // 基准点·受击
  trackHeading: 0x33ff66, // 履带朝向
  turn: 0xffdd33,         // 转向
  breech: 0xcc66ff,       // 炮闩
  deviation: 0xffffff,    // 偏差线
})

/** 判定结果串（可含 `→` 多段中的最后一段）→ 角色。未知/SPLASH 口径保持橙色。 */
export function resultRoleForOutcome(outcome: string | null | undefined): ShotResultRole {
  switch ((outcome ?? '').trim()) {
    case 'PENETRATION': return 'PENETRATION'
    case 'MAY_PENETRATE': return 'MAY_PENETRATE'
    case 'RICOCHET': return 'RICOCHET'
    case 'SPLASH': return 'SPLASH'
    case 'BLOCKED': return 'BLOCKED'
    case 'ERROR': return 'ERROR'
    default: return 'SPLASH'
  }
}

/**
 * 卡片最终展示结果 → 射线/HE 命中点角色（与 `renderShotResultCardHtml` 的标题/边框同源）。
 *
 * 射线必须和用户在卡片里第一眼看到的结论同色，不能只按确定性结果串解析：
 * - HE 0% 但仍有溅射 → SPLASH（橙），不是 BLOCKED/跳弹；
 * - HE 采样不可用 → ERROR（红）；
 * - 续飞最终段 1–99% → MAY_PENETRATE（黄），即使确定性均值是 blocked；
 * - 概率模式 → 总体累计概率的 0 红 / 1–99 黄 / 100 绿。
 *
 * 普通弹的命中点不用本函数：它落在首层接触面，颜色由首层角色决定
 * （`resultRoleForHitPoint`），否则双层装甲“首层可穿、次层挡下”时会把命中点
 * 错误地染成整体结论的红色。
 */
export function resultRoleForCardDisplay(input: {
  result: string
  heInfo: { unavailable?: boolean; splash_avg?: number | null } | null
  heChance: number
  probabilityMode: boolean
  overallChance: number | null
  chancePartial: boolean
}): ShotResultRole {
  const { result, heInfo, heChance, probabilityMode, overallChance, chancePartial } = input
  if (heInfo) {
    if (heInfo.unavailable) return 'ERROR'
    if (heChance >= 1) return 'PENETRATION'
    if (heChance > 0) return 'MAY_PENETRATE'
    const splash = typeof heInfo.splash_avg === 'number' && Number.isFinite(heInfo.splash_avg)
      ? heInfo.splash_avg
      : 0
    return splash > 0 ? 'SPLASH' : 'BLOCKED'
  }
  if (probabilityMode) return resultRoleForChance(overallChance ?? 0)
  if (chancePartial) return 'MAY_PENETRATE'
  return resultRoleForOutcome(result.split('→').pop() ?? '')
}

/**
 * 命中点角色：普通弹的命中点落在首层接触面，必须与结果卡第一层行同色。
 * 双层装甲首层可穿、次层挡下时，命中点是绿而不是整体结论的红；
 * 整体结论由射线/卡片标题表达。
 *
 * HE 溅射没有逐层穿透语义（卡片也不渲染层行），调用方传
 * `hasPerLayerDisplay=false` 回退到最终展示结果（橙/红）。
 */
export function resultRoleForHitPoint(input: {
  layerRoles?: ReadonlyArray<ShotResultRole> | null
  resultRole: ShotResultRole
  hasPerLayerDisplay: boolean
}): ShotResultRole {
  if (input.hasPerLayerDisplay) {
    const first = input.layerRoles?.[0]
    if (first) return first
  }
  return input.resultRole
}

/** 累计击穿概率 → 角色（0 红 / 1–99 黄 / 100 绿）。 */
export function resultRoleForChance(chance: number): ShotResultRole {
  if (chance >= 1) return 'PENETRATION'
  if (chance > 0) return 'MAY_PENETRATE'
  return 'BLOCKED'
}

/**
 * 接触点/卡片层行的唯一结果色映射。
 *
 * 结果卡已经证明这套顺序是对的：未到达 → 中性灰；无主装甲门禁 → 红；
 * 跳弹 → 紫；概率模式 → 该层局部 `layerChance`；续飞 1–99% → 局部概率黄；
 * 其余 → 该层确定性 penetrated 绿/红。卡片行与 3D 层点必须共用本函数，
 * 不得各自再写一套颜色分支。
 */
export interface LayerResultRoleInput {
  layer: {
    penetrated?: boolean
    ricochet?: boolean
    chance?: number | null
    layerChance?: number | null
    reached?: boolean
  }
  probabilityMode: boolean
  /** 无主装甲门禁：整条层链按挡下红显示（未到达层仍灰）。 */
  blockedNoPrimary?: boolean
  /** 非概率续飞 1–99%：该层在 partial chain 里的局部 chance（卡片行口径）。 */
  partialChance?: number | null
}

export function layerResultRole(input: LayerResultRoleInput): ShotResultRole {
  const { layer, probabilityMode, blockedNoPrimary = false, partialChance = null } = input
  if (layer.reached === false) return 'UNREACHED'
  if (blockedNoPrimary) return 'BLOCKED'
  if (layer.ricochet) return 'RICOCHET'
  if (probabilityMode) {
    const local = typeof layer.layerChance === 'number' && Number.isFinite(layer.layerChance)
      ? layer.layerChance
      : null
    return resultRoleForChance(local ?? (layer.chance ?? 0))
  }
  if (partialChance != null) return resultRoleForChance(partialChance)
  return layer.penetrated ? 'PENETRATION' : 'BLOCKED'
}

/** 数值色 → CSS `#rrggbb`（图例/调试文本与 3D 常量同源）。 */
export function cssHex(color: number): string {
  return '#' + (color >>> 0).toString(16).padStart(6, '0')
}

/** 场景亮变体查询（角色表是唯一来源，调用方不要直接写 hex）。 */
export function sceneResultColor(role: ShotResultRole): number {
  return SCENE_RESULT_COLORS[role]
}
