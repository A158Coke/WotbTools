import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import SwaggerParser from '@apidevtools/swagger-parser'

const openapiPath = fileURLToPath(new URL('../../contracts/http/openapi.yaml', import.meta.url))
const fixturePath = fileURLToPath(new URL('../../contracts/http/fixtures/battle-playback-v2.json', import.meta.url))
const document = await SwaggerParser.dereference(openapiPath)
const validate = new Ajv2020({ strict: false }).compile(document.components.schemas.BattlePlaybackDataset)
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
if (!validate(fixture)) {
  throw new Error(JSON.stringify(validate.errors, null, 2))
}
console.log('Playback V2 contract fixture: OK')
