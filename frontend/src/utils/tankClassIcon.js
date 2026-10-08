/**
 * Game-domain tactical symbols shared by planned markers and replay vehicles.
 * Solid diamond / two stripes / three stripes / inverted triangle are readable
 * at small sizes. The gaps are transparent, so both UI profiles and map imagery
 * use the same geometry. Unknown classes stay unknown; never infer from a name.
 */
export const TANK_CLASS_ICONS = Object.freeze([
  { key: 'LT', path: 'M12 2 22 12 12 22 2 12Z' },
  { key: 'MT', path: 'M12 2 22 12 17.8 16.2 7.8 6.2Z M6.2 7.8 16.2 17.8 12 22 2 12Z' },
  { key: 'HT', path: 'M12 2 22 12 19 15 9 5Z M8.25 5.75 18.25 15.75 15.75 18.25 5.75 8.25Z M5 9 15 19 12 22 2 12Z' },
  { key: 'TD', path: 'M2 4H22L12 22Z' },
].map(Object.freeze))

// Source spellings: annotation keys, playback Tankopedia classes, Agent types.
const CLASS_KEYS = Object.freeze({
  LT: 'LT', lightTank: 'LT', LIGHT_TANK: 'LT', 'Light tank': 'LT',
  MT: 'MT', mediumTank: 'MT', MEDIUM_TANK: 'MT', 'Medium tank': 'MT',
  HT: 'HT', heavyTank: 'HT', HEAVY_TANK: 'HT', 'Heavy tank': 'HT',
  TD: 'TD', 'AT-SPG': 'TD', TANK_DESTROYER: 'TD', 'Tank destroyer': 'TD',
})

export function tankClassIcon(value) {
  const key = typeof value === 'string' ? CLASS_KEYS[value] : undefined
  return TANK_CLASS_ICONS.find(icon => icon.key === key) || null
}
