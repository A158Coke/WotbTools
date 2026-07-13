import { describe, expect, it } from 'vitest'
import { normalizeSpringPage } from './page.js'

describe('normalizeSpringPage', () => {
  it('reads the Spring Page number field', () => {
    expect(normalizeSpringPage({
      number: 2,
      size: 20,
      totalElements: 53,
      totalPages: 3
    }, 0, 10)).toEqual({ page: 2, size: 20, totalElements: 53, totalPages: 3 })
  })

  it('uses request defaults when pagination metadata is absent', () => {
    expect(normalizeSpringPage({}, 4, 25)).toEqual({
      page: 4,
      size: 25,
      totalElements: 0,
      totalPages: 0
    })
  })
})
