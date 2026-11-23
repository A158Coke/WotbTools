// 测试专用：playbackScene 宿主源码全集（入口 facade + playback/ 下全部生产模块）。
// 源码级契约测试必须覆盖全部 owner：只读入口会漏掉已下沉到 playback/ 的实现（fail-open）。
// 合并 #1067 后场景实现采用 main 的 facade + playback/* 分层，PR 的 playbackSceneP1..P5
// 单文件方案不再存在；按目录收集可避免新增 owner 时再次漏扫。
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
