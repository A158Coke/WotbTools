import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const shard = Number(process.argv[2])
const conf = JSON.parse(readFileSync('stryker.conf.json', 'utf8'))
conf.mutate = JSON.parse(readFileSync('stryker-shards.json', 'utf8'))[shard]
conf.jsonReporter = { fileName: `reports/mutation-${shard}.json` }
conf.reporters = ['json', 'progress-append-only']
conf.concurrency = 4
writeFileSync('stryker.conf.json', JSON.stringify(conf))
process.exit(spawnSync('pnpm', ['exec', 'stryker', 'run', 'stryker.conf.json'], { stdio: 'inherit', shell: true }).status ?? 1)
