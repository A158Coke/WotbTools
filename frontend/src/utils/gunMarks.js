/** Recorded, earned vehicle marks; missing/invalid evidence stays unknown.
 * @param {unknown} value
 * @returns {number|null}
 */
export function gunMarksCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3 ? value : null
}

/** Derived identity lookup; the owning replay result remains the only fact source. */
export function gunMarksByAccount(result) {
  const counts = new Map()
  for (const player of result?.players || []) {
    if (Number.isSafeInteger(player.account_id) && player.account_id > 0) {
      counts.set(player.account_id, gunMarksCount(player.gun_marks))
    }
  }
  return counts
}
