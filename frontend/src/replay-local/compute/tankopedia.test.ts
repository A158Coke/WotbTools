import { describe, expect, it } from 'vitest'
import { loadTankopedia } from './tankopedia.js'

import tier1 from '../../../../common/tankopedia-tier1.json'
import tier2 from '../../../../common/tankopedia-tier2.json'
import tier3 from '../../../../common/tankopedia-tier3.json'
import tier4 from '../../../../common/tankopedia-tier4.json'
import tier5 from '../../../../common/tankopedia-tier5.json'
import tier6 from '../../../../common/tankopedia-tier6.json'
import tier7 from '../../../../common/tankopedia-tier7.json'
import tier8 from '../../../../common/tankopedia-tier8.json'
import tier9 from '../../../../common/tankopedia-tier9.json'
import tier10 from '../../../../common/tankopedia-tier10.json'

describe('packaged all-tier tankopedia', () => {
  it('loads every shipped tier through the production async loader', async () => {
    const library = await loadTankopedia()
    const documents = [tier1, tier2, tier3, tier4, tier5, tier6, tier7, tier8, tier9, tier10]
    const ids = new Set<number>()
    for (const [index, document] of documents.entries()) {
      expect(document.vehicles.length).toBeGreaterThan(0)
      for (const vehicle of document.vehicles) {
        expect(ids.has(vehicle.id)).toBe(false)
        ids.add(vehicle.id)
        expect(library.info(vehicle.id)).toMatchObject({ name: vehicle.name, tier: index + 1 })
      }
    }
    expect(library.size).toBe(ids.size)
  })

  it('resolves lower-tier names and keeps unknown IDs explicit', async () => {
    const library = await loadTankopedia()
    expect(library.info(10497)).toMatchObject({ name: 'KV-2', tier: 6 })
    expect(library.info(11553)).toMatchObject({ name: 'Hellcat', tier: 6 })
    expect(library.info(3585)).toMatchObject({ name: 'SU-100', tier: 6 })
    expect(library.info(10497).maxHp).toBeGreaterThan(0)
    expect(library.info(2147483647)).toMatchObject({ name: '#2147483647', tier: '', maxHp: null })
  })
})
