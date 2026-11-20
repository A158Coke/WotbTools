// 测试专用：BattlePlayback 拆分后的宿主源码全集（SFC + 五个 section，保持原始顺序）。
// 源码级契约测试必须覆盖全部 owner：只读入口 SFC 会漏掉已下沉到 part 的实现（fail-open）。
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