export interface SetupSelection {
  config: number
  turret: number
  gun: number
  /** 当前 config 的弹种下标（0..shells-1；默认 AP/首个非金币） */
  shell: number
  engine: number
  track: number
  devices: Array<0 | 1 | null>
  consumables: string[]
  provisions: string[]
  /** 已训练技能 → 等级（1–7；缺省 = 未训练，效果全局） */
  skills: Record<string, number>
  /** 显式模拟条件技能触发，缺省关闭；与训练等级分别保存。 */
  conditionalSkills?: boolean
  camouflage: boolean
  /** XI 客户端升级；缺省 stock 保持既有链接语义。custom = 部分研发（abilities 原表）。
   *  普通车辆不产生这两个字段。 */
  upgrade?: 'stock' | 'top' | 'custom'
  abilities?: number[]
}

export interface SetupResolved extends SetupSelection {
  canConfigure: boolean
}

export interface SetupSources {
  /** tank/{id}.json 详情 */
  detail: any
  /** 该车模块数据（国别文件的 tanks 条目）；null = 无数据 */
  modules: any
  /** parseTankopediaQuery 输出的 URL 状态 */
  url: any
  /** 资产包 research 全局目录（物品目录/预设/过滤器/技能） */
  catalog?: any
}
