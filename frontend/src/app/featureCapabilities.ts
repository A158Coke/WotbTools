import { ConnectivityState, isOnlineState, normalizeConnectivityState } from '../platform/connectivity.js'

type NoticeKeys = { messageKey: string; titleKey: string }

export type ProfileBackendContext = {
  authInitState?: string
  authenticated?: boolean
  connectivity?: unknown
  authEpoch?: number
}

export const FeatureRequirement = Object.freeze({
  LOCAL: 'local',
  ONLINE_REQUIRED: 'online-required',
  ONLINE_OPTIONAL: 'online-optional',
})

export const Feature = Object.freeze({
  REPLAY_IMPORT: 'replayImport',
  REPLAY_PARSING: 'replayParsing',
  REPLAY_RESULT: 'replayResult',
  RATING: 'rating',
  PLAYBACK_2D: 'playback2d',
  SHOOTING_INSPECTION: 'shootingInspection',
  REPLAY_HISTORY: 'replayHistory',
  AI_REVIEW: 'aiReview',
  HALL_OF_FAME: 'hallOfFame',
  PLAYBACK_3D: 'playback3d',
  ACCOUNT_PROFILE: 'accountProfile',
  ADMIN_USERS: 'adminUsers',
  ADMIN_BATTLE_DATA: 'adminBattleData',
  AI_FEEDBACK: 'aiFeedback',
  ADMIN_AI_FEEDBACK: 'adminAiFeedback',
  SITE_FEEDBACK: 'siteFeedback',
  ADMIN_SITE_FEEDBACK: 'adminSiteFeedback',
  TOURNAMENT_POINTS: 'tournamentPoints',
  LEAGUE_BROADCASTS: 'leagueBroadcasts',
  CREATORS: 'creators',
  TELEMETRY_UPLOAD: 'telemetryUpload',
  STATISTICS_CONTRIBUTION: 'statisticsContribution',
  BACKGROUND_SYNC: 'backgroundSync',
})

const REQUIREMENTS: Readonly<Record<string, string>> = Object.freeze({
  [Feature.REPLAY_IMPORT]: FeatureRequirement.LOCAL,
  [Feature.REPLAY_PARSING]: FeatureRequirement.LOCAL,
  [Feature.REPLAY_RESULT]: FeatureRequirement.LOCAL,
  [Feature.RATING]: FeatureRequirement.LOCAL,
  [Feature.PLAYBACK_2D]: FeatureRequirement.LOCAL,
  [Feature.SHOOTING_INSPECTION]: FeatureRequirement.LOCAL,
  [Feature.REPLAY_HISTORY]: FeatureRequirement.LOCAL,
  [Feature.AI_REVIEW]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.HALL_OF_FAME]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.PLAYBACK_3D]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.ACCOUNT_PROFILE]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.ADMIN_USERS]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.ADMIN_BATTLE_DATA]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.AI_FEEDBACK]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.ADMIN_AI_FEEDBACK]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.SITE_FEEDBACK]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.ADMIN_SITE_FEEDBACK]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.TOURNAMENT_POINTS]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.LEAGUE_BROADCASTS]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.CREATORS]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.TELEMETRY_UPLOAD]: FeatureRequirement.ONLINE_OPTIONAL,
  [Feature.STATISTICS_CONTRIBUTION]: FeatureRequirement.ONLINE_OPTIONAL,
  [Feature.BACKGROUND_SYNC]: FeatureRequirement.ONLINE_OPTIONAL,
})

export const UNKNOWN_FEATURE_REASON = 'unknown-feature'

export const SYNC_PAUSED_MESSAGE_KEY = 'featureOffline.syncPaused'

export const CONNECTIVITY_NOTICE: Readonly<Record<string, NoticeKeys>> = Object.freeze({
  [ConnectivityState.UNKNOWN]: Object.freeze({
    messageKey: 'connectivityNotice.unknown',
    titleKey: 'connectivityNotice.unknownTitle',
  }),
  [ConnectivityState.DEGRADED]: Object.freeze({
    messageKey: 'connectivityNotice.degraded',
    titleKey: 'connectivityNotice.degradedTitle',
  }),
  [ConnectivityState.SERVICE_UNAVAILABLE]: Object.freeze({
    messageKey: 'connectivityNotice.serviceUnavailable',
    titleKey: 'connectivityNotice.serviceUnavailableTitle',
  }),
})

const OFFLINE_TITLE_KEY = 'featureOffline.title'
const OFFLINE_HINT_KEY = 'featureOffline.retry'
const CONNECTIVITY_HINT_KEY = 'connectivityNotice.retry'

function noticeFor(reason: string, offlineBodyKey: string) {
  const connectivity = CONNECTIVITY_NOTICE[reason]
  if (!connectivity) {
    return { messageKey: offlineBodyKey, titleKey: OFFLINE_TITLE_KEY, hintKey: OFFLINE_HINT_KEY }
  }
  return {
    messageKey: connectivity.messageKey,
    titleKey: connectivity.titleKey,
    hintKey: CONNECTIVITY_HINT_KEY,
  }
}

export function featureRequirement(feature: string) {
  return REQUIREMENTS[feature] ?? null
}

export function isKnownFeature(feature: string) {
  return Object.prototype.hasOwnProperty.call(REQUIREMENTS, feature)
}

export function featuresByRequirement(requirement: string) {
  return Object.keys(REQUIREMENTS).filter(feature => REQUIREMENTS[feature] === requirement)
}

export function profileBackendAllowed({ authInitState, authenticated, connectivity }: ProfileBackendContext = {}) {
  if (authInitState !== 'authenticated' || authenticated !== true) return false
  return getFeatureAvailability(Feature.ACCOUNT_PROFILE, { connectivity }).available
}

export function getFeatureAvailability(feature: string, { connectivity = ConnectivityState.UNKNOWN }: { connectivity?: unknown } = {}) {
  const state = normalizeConnectivityState(connectivity)
  const online = isOnlineState(state)
  const requirement = featureRequirement(feature)

  if (requirement === null) {
    return Object.freeze({
      feature,
      requirement: null,
      available: false,
      reason: UNKNOWN_FEATURE_REASON,
      online: false,
      messageKey: null,
      titleKey: null,
      hintKey: null,
    })
  }

  if (requirement === FeatureRequirement.LOCAL) {
    return Object.freeze({
      feature,
      requirement,
      available: true,
      reason: null,
      online,
      messageKey: null,
      titleKey: null,
      hintKey: null,
    })
  }

  if (online) {
    return Object.freeze({
      feature,
      requirement,
      available: true,
      reason: null,
      online: true,
      messageKey: null,
      titleKey: null,
      hintKey: null,
    })
  }

  if (requirement === FeatureRequirement.ONLINE_OPTIONAL) {
    const notice = noticeFor(state, SYNC_PAUSED_MESSAGE_KEY)
    return Object.freeze({
      feature,
      requirement,
      available: true,
      reason: state,
      online: false,
      messageKey: notice.messageKey,
      titleKey: notice.titleKey,
      hintKey: notice.hintKey,
    })
  }

  const notice = noticeFor(state, `featureOffline.${feature}`)
  return Object.freeze({
    feature,
    requirement,
    available: false,
    reason: state,
    online: false,
    messageKey: notice.messageKey,
    titleKey: notice.titleKey,
    hintKey: notice.hintKey,
  })
}
