import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const playbackDir = resolve(here, 'playback')
const PARTS = [
  'playbackScene.js',
  ...readdirSync(playbackDir)
    .filter((file) => /\.(ts|js)$/.test(file) && !/\.test\./.test(file) && !file.endsWith('.d.ts'))
    .sort()
    .map((file) => 'playback/' + file),
]

export const PLAYBACK_SCENE_SOURCE = PARTS
  .map((file) => readFileSync(resolve(here, file), 'utf8'))
  .join(String.fromCharCode(10))

export default PLAYBACK_SCENE_SOURCE
