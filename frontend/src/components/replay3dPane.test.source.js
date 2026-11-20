// 测试专用：Replay3DPane 拆分后的宿主源码全集（SFC + 三个 section，保持原始顺序）。
// 源码级契约测试必须覆盖全部 owner：只读入口 SFC 会漏掉已下沉到 part 的实现（fail-open）。
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