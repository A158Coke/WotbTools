#!/usr/bin/env node
/**
 * 车型资产 CLI validator。
 *
 * 资产放回仓库后，ChatGPT/开发者可本地自检：
 *   node frontend/scripts/validate-vehicle-models.mjs
 *
 * 与 CI（frontend/src/vehicle-models/coverage.test.js + validate.test.js）同一套
 * validate.js 逻辑；输出 PASS/FAIL，存在任何 error 时退出码 1。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tankopedia from '../../common/tankopedia-tier10.json' with { type: 'json' }
import { MODEL_DEFINITIONS, TANK_ID_TO_MODEL } from '../src/vehicle-models/mapping.js'
import {
  listModelKeys,
  readModelDir,
  validateCoverage,
  validateModelEntry,
} from '../src/vehicle-models/validate.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function main() {
  let allErrors = 0

  const { errors: covErrors, stats } = validateCoverage({
    tankopedia,
    tankIdToModel: TANK_ID_TO_MODEL,
    modelDefinitions: MODEL_DEFINITIONS,
  })
  console.log('== Tier X coverage ==')
  console.log(`  tanks=${stats.tankCount} mapped=${stats.mappedCount} modelKeys=${stats.modelKeyCount}`)
  for (const e of covErrors) {
    console.error('  [FAIL] ' + e)
    allErrors += 1
  }
  if (covErrors.length === 0) console.log('  PASS')

  const modelKeys = listModelKeys()
  console.log('== assets/ 目录 ==')
  if (modelKeys.length === 0) {
    console.log('  （无资产目录；正式 SVG 由 ChatGPT 生成后放回）')
  }
  for (const modelKey of modelKeys) {
    const def = MODEL_DEFINITIONS[modelKey]
    const kind = def ? def.kind : null
    const files = readModelDir(modelKey)
    const errors = validateModelEntry({ modelKey, kind, files })
    const rel = path.join('frontend/src/vehicle-models/assets', modelKey)
    if (errors.length === 0) {
      console.log(`  PASS ${modelKey} [${kind ?? files.metadata ? JSON.parse(files.metadata).kind : '?'}]`)
    } else {
      console.error(`  [FAIL] ${modelKey}（${rel}）`)
      for (const e of errors) console.error('    - ' + e)
      allErrors += errors.length
    }
  }

  console.log(allErrors === 0 ? '\nRESULT: ALL PASS' : `\nRESULT: ${allErrors} ERROR(S)`)
  if (allErrors > 0) process.exit(1)
}

main()
