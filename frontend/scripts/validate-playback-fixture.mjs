import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import SwaggerParser from '@apidevtools/swagger-parser'
import { broadcastCategoryViewValidator } from '../src/api/generated/contract-validators.js'

const openapiPath = fileURLToPath(new URL('../../contracts/http/openapi.yaml', import.meta.url))
const fixturePath = fileURLToPath(new URL('../../contracts/http/fixtures/battle-playback-v2.json', import.meta.url))
const document = await SwaggerParser.dereference(openapiPath)
const ajv = new Ajv2020({ strict: false })
addFormats(ajv)
const validate = ajv.compile(document.components.schemas.BattlePlaybackDataset)
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
if (!validate(fixture)) {
  throw new Error(JSON.stringify(validate.errors, null, 2))
}
console.log('Playback V2 contract fixture: OK')

for (const [name, schema] of [
  ['creator-card', 'CreatorCard'],
  ['creator-detail', 'CreatorDetail'],
  ['creator-save-request', 'CreatorSaveRequest'],
  ['creator-settings', 'CreatorSettings'],
  ['creator-favorite-result', 'CreatorFavoriteResult'],
  ['creator-favorites', 'CreatorFavorites'],
]) {
  const value = JSON.parse(await readFile(new URL(`../../contracts/http/fixtures/${name}.json`, import.meta.url), 'utf8'))
  const check = ajv.compile(document.components.schemas[schema])
  if (!check(value)) throw new Error(`${name}: ${JSON.stringify(check.errors, null, 2)}`)
  console.log(`${schema} contract fixture: OK`)
}

const broadcast = JSON.parse(await readFile(new URL('../../contracts/http/fixtures/broadcast-category.json', import.meta.url), 'utf8'))
if (!broadcastCategoryViewValidator(broadcast)) {
  throw new Error(JSON.stringify(broadcastCategoryViewValidator.errors, null, 2))
}
// These are independent business dimensions: days and points-group labels must
// not inherit the bounds on round numbers or knockout group numbers.
for (const mutate of [
  value => { delete value.season.startDate },
  value => { value.season.server = 'UNKNOWN' },
  value => { value.nodes[0].roundNumber = 6 },
  value => { value.nodes[0].replays[0].dayNumber = 0 },
  value => { value.nodes[0].replays[0].groupNumber = 5 },
  value => { value.nodes[0].replays[0].matchDate = '2026-02-30' },
  value => { value.nodes[0].replays[0].teams.push('Fifth team') },
]) {
  const invalid = structuredClone(broadcast)
  mutate(invalid)
  if (broadcastCategoryViewValidator(invalid)) throw new Error('Invalid broadcast fixture unexpectedly accepted')
}
console.log('Broadcast directory contract fixture and boundary cases: OK')
