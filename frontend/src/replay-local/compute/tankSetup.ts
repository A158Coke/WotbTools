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
