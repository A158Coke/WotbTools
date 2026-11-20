export interface ComputeInput {
  /** research modules/{nation}.json 的单车条目 */
  modules: any
  turretIdx: number
  gunIdx: number
  engineIdx: number
  trackIdx: number
  /** XI 数值投影前的初始发动机功率，保持既有车体转速的装车/初始功率比。 */
  stockEnginePower?: number
  /** 火炮循环（tank/{id}.json config 的 is_drum/is_burst/burst_*；缺省=regular） */
  gunCycle?: {
    type: 'regular' | 'autoloader' | 'autoreloader'
    /** regular=单发装填；autoloader=整弹匣；autoreloader=最长单发 */
    reload: number
    /** 弹间装填（弹夹/自动装填）；regular=0 */
    intraClip: number
    /** 弹匣/连发容量；regular=0 */
    shellCount: number
    /** 自动装填逐发时间（autoreloader）；其余为空 */
    shellReloads: number[]
    /** 连发组每组发数（PomPom 类；0/1 = 无连发组）；组间仍按 intraClip */
    burstGroupCount?: number
    /** 连发组内弹间秒（BK `GunDefinition.burst.interval`） */
    burstGroupInterval?: number
  } | null
  /** tank/{id}.json 当前配置的标准弹（AP/首个非金币）；burst 炮可空 */
  standardShell: { damage: number; penetration: number; type: string; velocity?: number | null } | null
  /** @deprecated 肾上腺素改由 gunCycle.type === 'regular' 判定（客户端 filter 的 clip 排除）；
   *  保留字段仅为调用方兼容，引擎不再读取。 */
  isBurstGun: boolean
  /** tank/{id}.json 的装甲值（hull/turret × front/sides/rear），用于参数区装甲行 */
  armor?: { hull?: { front?: number; sides?: number; rear?: number }; turret?: { front?: number; sides?: number; rear?: number } } | null
  /** 装甲系数（强化装甲 110：客户端 script 的 armorHomogenizationFactor，未装 = 1） */
  armorFactor?: number
  /** 已选设备 id（resolveDeviceIds 输出） */
  deviceIds: number[]
  /** 乘员技能等级（0–7；未选技能 = 缺省 0，效果按满级百分比缩放） */
  skillLevels?: Record<string, number>
  /** 显式模拟条件技能触发；缺省 false，训练等级不会自动激活条件加成。 */
  conditionalSkills?: boolean
  /** 客户端 skills.json 的逐技能效果参数（per-level；不在此写死百分比） */
  skillEffects?: Record<string, { effects?: Record<string, number> }>
  provisionStems: string[]
  consumableStems: string[]
  /** 物品 script 摘要（provisions/consumables 的 {stem, script} 表） */
  provisionScripts: Record<string, any>
  consumableScripts: Record<string, any>
  camouflage: boolean
  /** 迷彩网客户端 script：`bonus` 逐车型系数 + 静止翻倍系数（devices.json camouflageNet） */
  camouflageNet?: { bonus?: Record<string, number>; activateBonusFactor?: number } | null
  /** 涂装隐蔽系数（camouflages.xml categories[defaultCategory]） */
  paintInvisibility?: Record<string, number> | null
  /** 车辆类别（lightTank/mediumTank/heavyTank/AT-SPG），类别加成用 */
  vehicleClass: string
  /** <crew> 角色表（modules.crewRoles）：专职角色 ×1.1；兼职（如 T-34 的 commander 兼
   *  gunner）在 BI 实测中不给加成，与 BK 的 1.05 兜底不同——按 BI 口径保持 1.0。 */
  crewRoles: string[]
}

export interface TankCharacteristics {
  /** 参数键 → 数值；辅助字段（_susp 等）不是客户端参数键，允许非数值 */
  [key: string]: any
}
