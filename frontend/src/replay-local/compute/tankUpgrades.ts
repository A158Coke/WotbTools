/** XI 客户端升级节点的选择与静态投影；普通车计算公式仍由 characteristics 负责。 */
export type {
  UpgradeMode, UpgradeValue, UpgradeAttribute, UpgradeNode, UpgradeGroup, UpgradeDefinition, UpgradeSelection,
} from './tankUpgradeTypes'
export { resolveUpgradeSelection, fullResearchXp } from './tankUpgradeSelection'
export { HIT_TRIGGER_ATTRIBUTES, boundAbility, upgradeMechanicEffects, mechanicParameterGroups } from './tankUpgradeMechanics'
export { projectTankUpgrades } from './tankUpgradeProjection'
