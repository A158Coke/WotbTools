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
  ['creator-metadata', 'CreatorMetadata'],
  ['recommendation-card', 'RecommendationCard'],
  ['recommendation-detail', 'RecommendationDetail'],
  ['recommendation-save-request', 'RecommendationSaveRequest'],
  ['recommendation-metadata', 'RecommendationMetadata'],
]) {
  const value = JSON.parse(await readFile(new URL(`../../contracts/http/fixtures/${name}.json`, import.meta.url), 'utf8'))
  const check = ajv.compile(document.components.schemas[schema])
  if (!check(value)) throw new Error(`${name}: ${JSON.stringify(check.errors, null, 2)}`)
  console.log(`${schema} contract fixture: OK`)
}

const recommendationRequest = JSON.parse(await readFile(new URL('../../contracts/http/fixtures/recommendation-save-request.json', import.meta.url), 'utf8'))
const invalidRecommendations = JSON.parse(await readFile(new URL('../../contracts/http/fixtures/recommendation-invalid-save-requests.json', import.meta.url), 'utf8'))
const validateRecommendation = ajv.compile(document.components.schemas.RecommendationSaveRequest)
for (const override of invalidRecommendations) {
  if (validateRecommendation({ ...recommendationRequest, ...override })) throw new Error(`Invalid recommendation request accepted: ${JSON.stringify(override)}`)
}
console.log('Recommendation request boundary fixtures: OK')

const broadcast = JSON.parse(await readFile(new URL('../../contracts/http/fixtures/broadcast-category.json', import.meta.url), 'utf8'))
if (!broadcastCategoryViewValidator(broadcast)) {
  throw new Error(JSON.stringify(broadcastCategoryViewValidator.errors, null, 2))
}
// These are independent business dimensions: days and points-group numbers must
// not inherit the bounds on round numbers or knockout group numbers.
for (const mutate of [
  value => { delete value.season.startDate },
  value => { value.season.server = 'UNKNOWN' },
  value => { value.nodes[0].roundNumber = 6 },
  value => { value.nodes[0].replays[0].dayNumber = 0 },
  value => { value.nodes[0].replays[0].groupNumber = 0 },
  value => { value.nodes[0].replays[0].groupNumber = 1.5 },
  value => { value.nodes[0].replays[0].groupNumber = 2147483648 },
  value => { value.nodes[0].replays[0].groupLabel = 'Group A' },
  value => { value.nodes[0].replays[0].matchDate = '2026-02-30' },
  value => { value.nodes[0].replays[0].teams.push('Fifth team') },
]) {
  const invalid = structuredClone(broadcast)
  mutate(invalid)
  if (broadcastCategoryViewValidator(invalid)) throw new Error('Invalid broadcast fixture unexpectedly accepted')
}
console.log('Broadcast directory contract fixture and boundary cases: OK')

// Frozen v1 wire remains closed: extra translated fields would break installed APKs.
const legacyBroadcastCategoryViewValidator = ajv.compile(document.components.schemas.LegacyBroadcastCategoryView)
const legacyBroadcast = JSON.parse(await readFile(new URL('../../contracts/http/fixtures/broadcast-category-v1.json', import.meta.url), 'utf8'))
if (!legacyBroadcastCategoryViewValidator(legacyBroadcast)) {
  throw new Error(JSON.stringify(legacyBroadcastCategoryViewValidator.errors, null, 2))
}
for (const mutate of [
  value => { value.season.nameZh = '新增字段' },
  value => { delete value.season.name },
  value => { delete value.nodes[0].replays[0].groupLabel },
  value => { value.nodes[0].replays[0].groupNumber = 5 },
]) {
  const invalid = structuredClone(legacyBroadcast)
  mutate(invalid)
  if (legacyBroadcastCategoryViewValidator(invalid)) throw new Error('Legacy APK shape unexpectedly changed')
}
console.log('Legacy broadcast APK wire fixture and closed-field boundaries: OK')

// V3 keeps the frozen v2 body nested, adding timezone/instant metadata only in the envelope.
const timedBroadcast = JSON.parse(await readFile(new URL('../../contracts/http/fixtures/broadcast-timed-category.json', import.meta.url), 'utf8'))
const validateTimed = ajv.compile(document.components.schemas.BroadcastTimedCategoryView)
if (!validateTimed(timedBroadcast)) throw new Error(JSON.stringify(validateTimed.errors, null, 2))
for (const mutate of [
  value => { delete value.defaultTimeZone },
  value => { value.defaultTimeZone = 'US/Pacific' },
  value => { value.replayStarts[0].startsAt = null },
  value => { value.replayStarts[0].startsAt = '2026-10-16' },
  value => { value.data.nodes[0].replays[0].startsAt = '2026-10-16T16:00:00Z' },
]) {
  const invalid = structuredClone(timedBroadcast)
  mutate(invalid)
  if (validateTimed(invalid)) throw new Error('Invalid timed broadcast fixture unexpectedly accepted')
}
const { id, nodeId, coverId, ...replaySave } = timedBroadcast.data.nodes[0].replays[0]
const timedSave = { replay: { ...replaySave, expectedVersion: 3, coverAction: 'KEEP', groupNumber: null }, startsAt: null }
const validateTimedSave = ajv.compile(document.components.schemas.BroadcastTimedReplaySave)
if (!validateTimedSave(timedSave)) throw new Error(JSON.stringify(validateTimedSave.errors, null, 2))
if (!validateTimedSave({ ...timedSave, startsAt: '2026-10-16T16:00:00Z' })) throw new Error('Known start instant rejected')
for (const invalid of [{ replay: timedSave.replay }, { ...timedSave, startsAt: '2026-10-16' }, { ...timedSave, replay: null }]) {
  if (validateTimedSave(invalid)) throw new Error('Invalid timed save accepted')
}
console.log('Timed broadcast envelope, optional groups and explicit time precision: OK')
