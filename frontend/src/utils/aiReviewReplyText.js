/** Resolve the authoritative display identity used by team review text and UI. */
export function teamIdentityLabel(result, playerKey, t) {
  const identity = Array.isArray(result.teamPlayers)
    ? result.teamPlayers.find(item => item?.playerKey === playerKey)
    : undefined
  const displayName = identity?.displayName?.trim() || t('recon.team.unknownPlayer')
  const tankName = identity?.tankName?.trim() || t('recon.team.unknownTank')
  return `${displayName} / ${tankName}`
}

/** Produce exactly the text offered by the copy action, including its footer. */
export function buildAiReviewReplyText(result, t) {
  const team = result.teamReview
  const text = team
    ? [
        team.summary.verdict,
        team.summary.primaryDiagnosis,
        ...team.episodes.map(episode => `${episode.title}\n${episode.analysis}`),
        ...team.trainingSuggestions.map(suggestion => `${suggestion.title}\n${suggestion.content}`),
        ...team.reviewFocus.map(item => `${teamIdentityLabel(result, item.playerKey, t)}: ${item.reason}`),
        ...team.highContributors.map(item => `${teamIdentityLabel(result, item.playerKey, t)}: ${item.reason}`)
      ].filter(Boolean).join('\n\n')
    : result.analysis
  return text ? text + '\n' + t('recon.copy_footer') : ''
}
