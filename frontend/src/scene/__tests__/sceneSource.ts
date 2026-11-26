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
