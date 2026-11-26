
import tier7 from '../../../../common/tankopedia-tier7.json'
import tier8 from '../../../../common/tankopedia-tier8.json'
import tier9 from '../../../../common/tankopedia-tier9.json'
import tier10 from '../../../../common/tankopedia-tier10.json'
import { createTankopedia, type Battle, type ParsedEntry } from '../compute/index.js'
import batches from './batches.json'
import javaBattles from './java-battles.json'

export const goldenTankopedia = createTankopedia([tier7, tier8, tier9, tier10])
export const goldenBatches = batches as Record<string, string[]>

const battlesByFile = javaBattles as unknown as Record<string, Battle | { error: string }>

export function messageOf(stringified: string): string {
  return stringified.replace(/^[\w$.]+(?:Exception|Error|Throwable): /, '')
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function entriesFor(paths: readonly string[]): ParsedEntry[] {
  return paths.map((path, sourceIndex) => {
    const sourceName = fileName(path)
    const parsed = battlesByFile[sourceName]
    if (parsed === undefined) throw new Error(`golden missing battle for ${sourceName}`)
    if ('error' in parsed) return { sourceIndex, sourceName, battle: null, failureMessage: messageOf(parsed.error) }
    return { sourceIndex, sourceName, battle: structuredClone(parsed), failureMessage: null }
  })
}
