import SwaggerParser from '@apidevtools/swagger-parser'
import { fileURLToPath } from 'node:url'

const input = new URL('../../contracts/http/openapi.yaml', import.meta.url)
await SwaggerParser.validate(fileURLToPath(input))
console.log('OpenAPI syntax and local $ref resolution: OK')
