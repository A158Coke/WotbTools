import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import SwaggerParser from '@apidevtools/swagger-parser'
import { broadcastSeasonContentsValidator, broadcastTimedCategoryViewValidator, broadcastTimedReplaySaveValidator } from '../src/api/generated/contract-validators.js'

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

// 同一固定样本由 ApiContractTest 与真实 Java DTO/mapper 序列化结果逐字段比较。
const businessBoundaries = JSON.parse(await readFile(new URL('../../contracts/http/fixtures/business-boundaries.json', import.meta.url), 'utf8'))
for (const { schema, value } of businessBoundaries) {
  const check = ajv.compile(document.components.schemas[schema])
  if (!check(value)) throw new Error(`${schema}: ${JSON.stringify(check.errors, null, 2)}`)
}
console.log('Business boundary producer serialization fixtures: OK')

for (const [name, schema] of [
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

const seasonContents = JSON.parse(await readFile(new URL('../../contracts/http/fixtures/broadcast-season-contents.json', import.meta.url), 'utf8'))
if (!broadcastSeasonContentsValidator(seasonContents)) throw new Error(JSON.stringify(broadcastSeasonContentsValidator.errors, null, 2))
for (const mutate of [
  value => { delete value.categories },
  value => { delete value.nodes },
  value => { value.defaultTimeZone = 'UNKNOWN' },
  value => { value.categories[0].type = 'UNKNOWN' },
  value => { delete value.nodes[0].categoryId },
  value => { value.replayStarts[0].startsAt = null },
  value => { value.extra = true },
]) {
  const invalid = structuredClone(seasonContents)
  mutate(invalid)
  if (broadcastSeasonContentsValidator(invalid)) throw new Error('Invalid broadcast season contents accepted')
}
console.log('Broadcast season contents fixture and closed-field boundaries: OK')

const timedBroadcast = JSON.parse(await readFile(new URL('../../contracts/http/fixtures/broadcast-timed-category.json', import.meta.url), 'utf8'))
const validateTimed = broadcastTimedCategoryViewValidator
if (!validateTimed(timedBroadcast)) throw new Error(JSON.stringify(validateTimed.errors, null, 2))
const noGroup = structuredClone(timedBroadcast)
noGroup.data.nodes[0].replays[0].groupNumber = null
if (!validateTimed(noGroup)) throw new Error('Optional broadcast group rejected')
// Days and points groups are independent of round and knockout group bounds.
for (const mutate of [
  value => { delete value.data.season.startDate },
  value => { value.data.season.server = 'UNKNOWN' },
  value => { value.data.season.name = 'Legacy name' },
  value => { value.data.nodes[0].roundNumber = 6 },
  value => { value.data.nodes[0].replays[0].dayNumber = 0 },
  value => { delete value.data.nodes[0].replays[0].groupNumber },
  value => { value.data.nodes[0].replays[0].groupNumber = 0 },
  value => { value.data.nodes[0].replays[0].groupNumber = 1.5 },
  value => { value.data.nodes[0].replays[0].groupNumber = 2147483648 },
  value => { value.data.nodes[0].replays[0].groupLabel = 'Group A' },
  value => { value.data.nodes[0].replays[0].matchDate = '2026-02-30' },
  value => { value.data.nodes[0].replays[0].teams.push('Fifth team') },
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
const validateTimedSave = broadcastTimedReplaySaveValidator
if (!validateTimedSave(timedSave)) throw new Error(JSON.stringify(validateTimedSave.errors, null, 2))
if (!validateTimedSave({ ...timedSave, startsAt: '2026-10-16T16:00:00Z' })) throw new Error('Known start instant rejected')
for (const invalid of [
  { replay: timedSave.replay },
  { ...timedSave, startsAt: '2026-10-16' },
  { ...timedSave, replay: null },
  { ...timedSave, replay: { ...timedSave.replay, groupNumber: 0 } },
  { ...timedSave, replay: { ...timedSave.replay, groupNumber: 1.5 } },
  { ...timedSave, replay: { ...timedSave.replay, groupNumber: 2147483648 } },
  { ...timedSave, replay: { ...timedSave.replay, groupLabel: 'Group A' } },
  timedSave.replay,
]) {
  if (validateTimedSave(invalid)) throw new Error('Invalid timed save accepted')
}
console.log('Broadcast contract envelope, nested business boundaries, optional groups and explicit time precision: OK')

// Collector结构与跨字段约束由OpenAPI独立验证。
const battle = JSON.parse(await readFile(new URL('../../contracts/http/fixtures/battle-data.json', import.meta.url), 'utf8'))
const checkBattle = ajv.compile(document.components.schemas.BattleDataRequest)
if (!checkBattle(battle)) throw new Error(JSON.stringify(checkBattle.errors))
for (const mutate of [
  value => { value.arenaBonusType = 2 },
  value => { value.schemaVersion = 2 },
  value => { value.arenaId = '18446744073709551616' },
  value => { value.arenaId = '123\n' },
  value => { value.mapKey = 'rift\n' },
  value => { value.clientVersion = '11.18.0\n' },
  value => { value.winnerTeam = null },
  value => { value.accountId = 123 },
  value => { value.teams[0].vehicles.pop() },
  value => { value.teams[1].team = 1 },
  value => { value.teams[1].spawn = 'SOUTH' },
  value => { value.teams[1].spawn = 'WEST' },
]) {
  const invalid = structuredClone(battle)
  mutate(invalid)
  if (checkBattle(invalid)) throw new Error('Invalid Collector contract fixture accepted')
}
console.log('Battle data request contract fixtures: OK')
// Admin read shapes: empty database, uint64 arena and bigint id remain lossless strings.
const adminBattle = { id: '9223372036854775807', arenaId: '18446744073709551615', schemaVersion: 1, arenaBonusType: 1, mapId: 42, mapKey: 'rift', clientVersion: '11.18', winnerTeam: 0, team1Spawn: 'NORTH', team2Spawn: 'SOUTH', receivedAt: '2026-10-29T00:00:00Z' }
const adminEmpty = { asOf: '2026-10-29T00:00:00Z', totalBattles: 0, last24Hours: 0, last7Days: 0, last30Days: 0, windowBattles: 0, latestReceivedAt: null, distinctMaps: 0, distinctClientVersions: 0, modes: [], winnerTeams: [], schemaVersions: [], daily: [], maps: [], clientVersions: [], spawnStats: [{ mapKey: 'rift', arenaBonusType: null, side: 'NORTH', battles: 1, wins: 1, draws: 0, losses: 0 }] }
for (const [schema, valid, invalid] of [
  ['BattleDataAdminSummary', adminEmpty, { ...adminEmpty, windowBattles: -1 }],
  ['BattleDataAdminPage', { items: [adminBattle], nextCursor: null }, { items: [{ ...adminBattle, id: 9223372036854775807 }], nextCursor: null }],
  ['BattleDataAdminDetail', { battle: adminBattle, vehicles: [{ team: 1, slot: 0, vehicleId: 42 }] }, { battle: adminBattle, vehicles: [{ team: 1, slot: 7, vehicleId: 42 }] }],
]) {
  const check = ajv.compile(document.components.schemas[schema])
  if (!check(valid)) throw new Error(`${schema} valid fixture rejected: ${JSON.stringify(check.errors)}`)
  if (check(invalid)) throw new Error(`${schema} invalid fixture accepted`)
}
console.log('Battle data admin read contract fixtures: OK')
