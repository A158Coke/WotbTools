import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PARTS = [
  'BattlePlayback.vue',
  'battlePlaybackA.ts',
  'battlePlaybackB.ts',
  'battlePlaybackC.ts',
  'battlePlaybackD.ts',
  'battlePlaybackE.ts',
]

export const BATTLE_PLAYBACK_SOURCE = PARTS
  .map((file) => readFileSync(resolve(here, file), 'utf8'))
  .join(String.fromCharCode(10))

export default BATTLE_PLAYBACK_SOURCE