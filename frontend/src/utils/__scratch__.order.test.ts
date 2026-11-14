import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { orderDatasetsForDisplay } from './datasetOrder'

describe('scratch: local catalog order', () => {
  it('prints the rendered order for the local versions.json', () => {
    const doc = JSON.parse(readFileSync('D:/Class/Rust/Project/release/versions.json', 'utf-8'))
    const ordered = orderDatasetsForDisplay(doc.datasets)
    console.log('ordered:', ordered.map(e => `${e.id}(${e.variant ?? 'release'})`))
    console.log('default:', doc.default)
    void doc
  })
})
