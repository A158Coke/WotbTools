/**
 * 配置器状态解析（纯函数）：客户端导出数据 + URL 状态 → characteristics 引擎输入 / 参数行。
 *
 * 选择模型（单一 owner）：
 * - 炮塔+炮由 `?config=`（tank/{id}.json configs 下标）唯一决定；两个下拉只做“同一对 (turret, gun)
 *   在哪一档配置里”的投影，改动即写回 config，不保存第二份炮塔/炮状态。
 * - 发动机/履带是模块级选择（`?engine=` / `?track=`），默认顶级（末位）。
 * - 装备 9 槽 `?dev=`（`0`=左 / `1`=右 / `-`=空），默认全空（BK 语义，见上游方案 §5.1）。
 * - 消耗品/补给 `?cons=` / `?prov=`：**键缺省 = 客户端默认表**，键存在但为空 = 用户清空。
 * - 涂装 `?camo=1`，默认关。
 *
 * 数据面：资产包 research/modules/{nation}.json（客户端原值）+ tank/{id}.json（装甲/弹种）。
 * 任何映射缺失（无模块、config 无 turret_local/gun_local 对号）都返回 canConfigure=false，
 * 调用方保留静态百科展示，不猜默认值（fail-closed）。
 */
export type { SetupSelection, SetupResolved, SetupSources } from './tankSetupTypes'
export {
  DEVICE_SLOT_COUNT, findTankModules, configIndexFor, decodeDevices, encodeDevices, gunCycleOf,
  defaultShellIndex, standardShellOf, tankRef, presetSlots, presetProvidesPitchDevice,
  resolvePitchDeviceEffective, resolvePitchCheckboxChecked, pitchDeviceBonus,
  recordedTargetMatchesShot, devicesFromEquipmentIds,
} from './tankSetupHelpers'
export {
  resolveSetup, normalizeSetup, resolveArmor, pitchAtBearing, armorFactorFor,
  consumableTiming, buildComputeInput, baseSelection, pickTurret, pickGun,
} from './tankSetupCore'
export type { ParamRow, ParamGroup, ArmorCell } from './tankSetupParameters'
export { ARMOR_ROWS, paramGroups, computeSetupPair, armorRows } from './tankSetupParameters'
