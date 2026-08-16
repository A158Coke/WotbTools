/**
 * Tier X 专属车型 — 集中静态 Tank ID → baseModelKey 映射（计划 §8）。
 *
 * 权威来源：common/tankopedia-tier10.json（84 辆 → 81 个 baseModelKey）。
 * 覆盖契约：Tier X 必须 100% 有 mapping；未来新增 Tier X 缺失 mapping → CI FAIL
 * （frontend/src/vehicle-models/coverage.test.js）。
 *
 * 分组规则（本阶段）：同一基础车型的不同 skin / 特殊版本 / 多 ID 复用同一模型；
 * 不扩展特殊版本专属模型。当前 3 组合并：
 * - sheridan:     Sheridan (20257) + Sheridan Missile (21793)
 * - kpz-70:       Kpz 70 (11281) + Kpz 70 Missile (30481)
 * - type-5-heavy: Type 5 Heavy (8033) + Type 5 H Zetsu (9057)
 * 其余同名前缀（E 100 / Jg.Pz. E 100 等）为结构不同的独立车型，各自独立 modelKey。
 *
 * 本文件不存 display name（继续来自 Tankopedia/replay），不建立第二套
 * canonical tank database。kind（turreted/turretless）是 mapping 的事实声明，
 * 资产 metadata.json 必须与之一致（validator 校验）。
 *
 * kind 核验（2026-08-17，全 81 组）：基于官方 tankopedia 描述 / fandom wiki /
 * 车辆实际俯视结构核验，不采用 BlitzKit TURRET module 或 turretRotationSpeed
 * 字段（casemate 也有 turret module 且转速非零，不可判）。修正记录：
 * - minotauro: turretless → turreted（fandom：有炮塔，约 45° 限位）
 * - foch-155:  turreted → turretless（fandom specs turret=no，固定/微转前向炮塔）
 * - xm66f:     turretless → turreted（官方 tankopedia：non-fully-rotating turret）
 * confirmPending=true 的车型（ac-teichos / nc-70-blyskawica）无法从当前参考资料可靠确认
 * 结构，ChatGPT 生成时需对照 BlitzKit 参考图确认 kind，不一致时同步修正 mapping 与 metadata；
 * 确认前这些车型的 contract 未冻结。spht（29985）已于 2026-08-19 经 BlitzKit 数据确认
 * turreted（GLB turret_01 + gun_01 + gun_01_mask；models.pb turret 模块无 yaw 限位）→ 解除 confirmPending。
 */

/** modelKey → { kind, tankIds }。 */
export const MODEL_DEFINITIONS = Object.freeze({
  "progetto-65": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([385]) }),
  "bc-25-t": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([3649]) }),
  "stb-1": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([3681]) }),
  "ho-ri": Object.freeze({ kind: 'turretless', tankIds: Object.freeze([3937]) }),
  "wz-121": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([4145]) }),
  "amx-m4-mle-54": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([4417]) }),
  "kranvagn": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([4481]) }),
  "wz-113": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([5425]) }),
  "tvp-t-50-51": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([5505]) }),
  "121b": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([5681]) }),
  "is-4": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([6145]) }),
  "amx-50-b": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([6209]) }),
  "fv215b": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([6225]) }),
  "wz-113g-ft": Object.freeze({ kind: 'turretless', tankIds: Object.freeze([6449]) }),
  "type-71": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([6753]) }),
  "maus": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([6929]) }),
  "is-7": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([7169]) }),
  "fv4202": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([7249]) }),
  "60tp-lewandowskiego": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([7297]) }),
  "type-5-heavy": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([8033, 9057]) }),
  "wz-111-5a": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([8497]) }),
  "amx-30-b": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([8513]) }),
  "fv215b-183": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([9297]) }),
  "e-100": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([9489]) }),
  "carro-45t": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([10113]) }),
  "wz-132-1": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([10289]) }),
  "minotauro": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([10369]) }),
  "t110e5": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([10785]) }),
  "114-sp2": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([11057]) }),
  "kpz-70": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([11281, 30481]) }),
  "bz-75": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([11825]) }),
  "jgpz-e-100": Object.freeze({ kind: 'turretless', tankIds: Object.freeze([12049]) }),
  "strv-k": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([12161]) }),
  "e-50-m": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([12305]) }),
  "116-f3": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([12849]) }),
  "t110e4": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([13089]) }),
  "vz-55": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([13185]) }),
  "obj-268": Object.freeze({ kind: 'turretless', tankIds: Object.freeze([13569]) }),
  "t-62a": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([13825]) }),
  "t110e3": Object.freeze({ kind: 'turretless', tankIds: Object.freeze([13857]) }),
  "foch-155": Object.freeze({ kind: 'turretless', tankIds: Object.freeze([13889]) }),
  "m48-patton": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([14113]) }),
  "bzt-70": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([14129]) }),
  "obj-263": Object.freeze({ kind: 'turretless', tankIds: Object.freeze([14337]) }),
  "leopard-1": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([14609]) }),
  "t57-heavy": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([14881]) }),
  "cs-63": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([14977]) }),
  "obj-907": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([15617]) }),
  "chieftain-mk-6": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([15697]) }),
  "m60": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([15905]) }),
  "obj-140": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([16897]) }),
  "fv217-badger": Object.freeze({ kind: 'turretless', tankIds: Object.freeze([17745]) }),
  "rinoceronte": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([17793]) }),
  "fv4005": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([18001]) }),
  "lion": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([18049]) }),
  "t95e6": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([18977]) }),
  "grille-15": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([19217]) }), // limited-traverse 炮塔 TD（BlitzKit models.pb turret yaw ±65°；yaw 有界仍属 turreted visual layer）
  "super-conqueror": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([19281]) }),
  "vickers-light": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([19537]) }),
  "nc-70-blyskawica": Object.freeze({ kind: 'turreted', confirmPending: true, tankIds: Object.freeze([19585]) }),
  "ac-atlas": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([19825]) }),
  "t-22-medium": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([19969]) }),
  "felice": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([20097]) }),
  "sheridan": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([20257, 21793]) }),
  "projet-murat": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([21057]) }),
  "vk-90-01-p": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([21777]) }),
  "ac-teichos": Object.freeze({ kind: 'turreted', confirmPending: true, tankIds: Object.freeze([22129]) }),
  "obj-260": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([22273]) }),
  "m-vi-yoh": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([22817]) }),
  "m47-chevalier": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([23105]) }),
  "kpz-50-t": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([23313]) }),
  "t-100-lt": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([24321]) }),
  "object-268-4": Object.freeze({ kind: 'turretless', tankIds: Object.freeze([24577]) }),
  "concept-1b": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([24609]) }),
  "gsor-the-tank": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([25169]) }),
  "obj-777-ii": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([25857]) }),
  "rhm-pzw": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([28689]) }),
  "xm66f": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([28705]) }),
  "waffen-f1-0": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([28945]) }),
  "spht": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([29985]) }), // 2026-08-19 BlitzKit 数据确认 turreted（GLB turret_01 + gun_01 + gun_01_mask；models.pb turret 模块无 yaw 限位）
  "vk-72-01-k": Object.freeze({ kind: 'turreted', tankIds: Object.freeze([58641]) })
})

/** tankId → modelKey（字符串键，mapping 查找统一走 String(tankId)）。 */
export const TANK_ID_TO_MODEL = Object.freeze(
  Object.fromEntries(
    Object.entries(MODEL_DEFINITIONS).flatMap(([modelKey, def]) =>
      def.tankIds.map((id) => [String(id), modelKey]),
    ),
  ),
)

