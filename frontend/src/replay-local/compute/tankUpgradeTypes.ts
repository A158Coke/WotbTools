export type UpgradeMode = 'stock' | 'top' | 'custom'
export type UpgradeValue = number | boolean
export interface UpgradeAttribute { name: string; value: UpgradeValue }
export interface UpgradeNode {
  id: number
  techName: string
  type: 'NODETYPE_COMMON' | 'NODETYPE_MECHANIC' | 'NODETYPE_ALTERNATIVE_MECHANIC'
  attributes: UpgradeAttribute[]
  [key: string]: unknown
}
export interface UpgradeGroup { id: string; choices: number[]; [key: string]: unknown }
export interface UpgradeDefinition {
  modifier: 'MODIFIER_ADD' | 'MODIFIER_MULTIPLY' | 'MODIFIER_BOOLEAN'
  script?: string
  params?: Record<string, string>
  [key: string]: unknown
}
export interface UpgradeSelection {
  available: boolean
  supported: boolean
  mode: UpgradeMode
  choices: Record<string, number>
  abilities: number[]
  attributes: Record<string, UpgradeValue>
  mechanicsAttributes: Record<string, UpgradeValue>
  unsupported: string[]
  nodes: UpgradeNode[]
  groups: UpgradeGroup[]
  attributeDefinitions: Record<string, UpgradeDefinition>
}
