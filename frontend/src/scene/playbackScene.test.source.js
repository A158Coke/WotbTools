// 测试专用：playbackScene 拆分后的宿主源码全集（入口 + 五个 part，保持原始顺序）。
// 源码级契约测试必须覆盖全部 owner：只读入口会漏掉已下沉到 part 的实现（fail-open）。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PARTS = [
  'playbackScene.js',
  'playbackSceneP1.ts',
  'playbackSceneP2.ts',
  'playbackSceneP3.ts',
  'playbackSceneP4.ts',
  'playbackSceneP5.ts',
]

export const PLAYBACK_SCENE_SOURCE = PARTS
  .map((file) => readFileSync(resolve(here, file), 'utf8'))
  .join(String.fromCharCode(10))

export default PLAYBACK_SCENE_SOURCE
