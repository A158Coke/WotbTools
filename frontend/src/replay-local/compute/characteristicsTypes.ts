export interface ComputeInput {
  modules: any
  turretIdx: number
  gunIdx: number
  engineIdx: number
  trackIdx: number
  stockEnginePower?: number
  gunCycle?: {
    type: 'regular' | 'autoloader' | 'autoreloader'
    reload: number
    intraClip: number
    shellCount: number
    shellReloads: number[]
    burstGroupCount?: number
    burstGroupInterval?: number
  } | null
  standardShell: { damage: number; penetration: number; type: string; velocity?: number | null } | null
  isBurstGun: boolean
  armor?: { hull?: { front?: number; sides?: number; rear?: number }; turret?: { front?: number; sides?: number; rear?: number } } | null
  armorFactor?: number
  deviceIds: number[]
  skillLevels?: Record<string, number>
  conditionalSkills?: boolean
  skillEffects?: Record<string, { effects?: Record<string, number> }>
  provisionStems: string[]
  consumableStems: string[]
  provisionScripts: Record<string, any>
  consumableScripts: Record<string, any>
  camouflage: boolean
  camouflageNet?: { bonus?: Record<string, number>; activateBonusFactor?: number } | null
  paintInvisibility?: Record<string, number> | null
  vehicleClass: string
  crewRoles: string[]
}

export interface TankCharacteristics {
  [key: string]: any
}
