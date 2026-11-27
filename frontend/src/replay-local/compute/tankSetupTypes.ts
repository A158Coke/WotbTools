export interface SetupSelection {
  config: number
  turret: number
  gun: number
  shell: number
  engine: number
  track: number
  devices: Array<0 | 1 | null>
  consumables: string[]
  provisions: string[]
  skills: Record<string, number>
  conditionalSkills?: boolean
  camouflage: boolean
  upgrade?: 'stock' | 'top' | 'custom'
  abilities?: number[]
}

export interface SetupResolved extends SetupSelection {
  canConfigure: boolean
}

export interface SetupSources {
  detail: any
  modules: any
  url: any
  catalog?: any
}
