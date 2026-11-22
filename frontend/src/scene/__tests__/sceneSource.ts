// 2026-11-22 源码文本断言兼容层：playbackScene.js / tankViewer.js 已拆分为宿主 + owner 模块，
// 源码级契约测试需要看到"拆分前的整体实现"。这里按拆分前顺序拼接宿主与各 owner 文件，
// 使既有断言仍然锁定同一份实现文本；新断言应直接读取具体 owner 文件。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCENE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const PLAYBACK_PARTS = [
  'playbackScene.js',
  'playback/sceneHost.ts',
  'playback/sceneState.ts',
  'playback/sceneAssembly.ts',
  'playback/renderLoop.ts',
  'playback/transport.ts',
  'playback/sessionRuntime.ts',
  'playback/publicApi.ts',
]

const TANK_VIEWER_PARTS = [
  'tankViewer.js',
  'tankViewer/sceneHost.ts',
  'tankViewer/tankStatus.ts',
  'tankViewer/tankArmor.ts',
  'tankViewer/tankScene.ts',
  'tankViewer/tankTransport.ts',
  'tankViewer/tankRuntime.ts',
  'tankViewer/tankLoop.ts',
  'tankViewer/tankApi.ts',
  'tankViewer/viewerGlobals.ts',
  'tankViewer/domById.ts',
]

function readParts(parts: string[]): string {
  return parts.map((part) => readFileSync(resolve(SCENE_DIR, part), 'utf8')).join('\n')
}

/**
 * 把宿主对象拆分还原成拆分前的闭包文本形态：
 * owner 模块统一以 `S` 宿主读取原闭包变量（S.store、S.DATA……），而拆分前的源码级契约
 * 直接使用闭包名。去掉 `S.` 前缀与函数签名里的宿主参数后，既有断言仍然锁定同一实现语义。
 */
function legacyView(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/\bS\./g, '')
    .replace(/\(S: Host\)/g, '()')
    .replace(/\(S: Host, /g, '(')
    .replace(/\(_S: Host\)/g, '()')
    .replace(/\(_S: Host, /g, '(')
}

export interface SceneSourceOptions {
  /** raw=true 保留 owner 模块的宿主对象形态（断言显式针对 S.* 时使用）。 */
  raw?: boolean
}

export function playbackSceneSource(options: SceneSourceOptions = {}): string {
  const source = readParts(PLAYBACK_PARTS)
  return options.raw ? source : legacyView(source)
}

export function tankViewerSource(options: SceneSourceOptions = {}): string {
  const source = readParts(TANK_VIEWER_PARTS)
  return options.raw ? source : legacyView(source)
}
