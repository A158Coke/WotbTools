import { readFile } from 'node:fs/promises'

const path = process.argv[2]
if (!path || process.argv.length !== 3) throw new Error('Expected a jscpd JSON report path')
const report = JSON.parse(await readFile(path, 'utf8'))
const total = report?.statistics?.total
const duplicates = report?.duplicates
if (!Array.isArray(duplicates) || !Number.isInteger(total?.sources) || total.sources < 1 ||
    !Number.isInteger(total?.newClones) || total.newClones < 0 ||
    duplicates.some(clone => typeof clone.isNew !== 'boolean') ||
    duplicates.filter(clone => clone.isNew).length !== total.newClones) {
  throw new Error('Invalid or incomplete jscpd baseline comparison report')
}
console.log(`jscpd scanned ${total.sources} sources; ${total.newClones} new clone candidates require review`)
