import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PARTS = [
  'Replay3DPane.vue',
  'replay3dPaneA.ts',
  'replay3dPaneB.ts',
  'replay3dPaneC.ts',
]

export const REPLAY_3D_PANE_SOURCE = PARTS
  .map((file) => readFileSync(resolve(here, file), 'utf8'))
  .join(String.fromCharCode(10))

export default REPLAY_3D_PANE_SOURCE