import { ConnectivityState, isOnlineState, normalizeConnectivityState } from '../platform/connectivity.js'

/**
 * Feature capability model —— 「这个功能现在能不能用」的**唯一**判定入口（计划 §2）。
 *
 * 为什么必须集中：如果 AI 页面、HoF 页面、3D 页面各自写
 * `if (!navigator.onLine)`，就会出现三套判定、三种提示、三种边界行为，而且每一处都必须
 * 自己记得「离线不是错误状态」。这里把「功能需要什么」与「当前连通性是什么」分开：
 *
 * ```text
 * FEATURE_REQUIREMENTS（业务要求，静态）  ×  connectivity state（环境事实，动态）
 *                    ↓
 *        getFeatureAvailability(feature)
 * ```
 *
 * 返回对象刻意与 i18n 解耦（只给 messageKey），因此可以在纯 JVM/Node 单测里断言行为，
 * 不需要渲染任何 UI（计划 §29：测 capability model，不测文案）。
 */
export const FeatureRequirement = Object.freeze({
  /** 完全本地：解析、结果、评分、2D（所需资源已随包提供）。 */
  LOCAL: 'local',
  /** 没有网络就没有该功能：入口可发现，点击给明确提示，**绝不等超时**。 */
  ONLINE_REQUIRED: 'online-required',
  /** 本地部分照常可用，联网部分（上传 / 同步）需要网络。 */
  ONLINE_OPTIONAL: 'online-optional',
})

/** 功能 id（SSOT）。字符串值同时是 i18n key 片段：`featureOffline.<id>`。 */
export const Feature = Object.freeze({
  REPLAY_IMPORT: 'replayImport',
  REPLAY_PARSING: 'replayParsing',
  REPLAY_RESULT: 'replayResult',
  RATING: 'rating',
  PLAYBACK_2D: 'playback2d',
  REPLAY_HISTORY: 'replayHistory',
  AI_REVIEW: 'aiReview',
  HALL_OF_FAME: 'hallOfFame',
  PLAYBACK_3D: 'playback3d',
  ACCOUNT_PROFILE: 'accountProfile',
  TELEMETRY_UPLOAD: 'telemetryUpload',
  STATISTICS_CONTRIBUTION: 'statisticsContribution',
  BACKGROUND_SYNC: 'backgroundSync',
})

const REQUIREMENTS = Object.freeze({
  [Feature.REPLAY_IMPORT]: FeatureRequirement.LOCAL,
  [Feature.REPLAY_PARSING]: FeatureRequirement.LOCAL,
  [Feature.REPLAY_RESULT]: FeatureRequirement.LOCAL,
  [Feature.RATING]: FeatureRequirement.LOCAL,
  [Feature.PLAYBACK_2D]: FeatureRequirement.LOCAL,
  [Feature.REPLAY_HISTORY]: FeatureRequirement.LOCAL,
  [Feature.AI_REVIEW]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.HALL_OF_FAME]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.PLAYBACK_3D]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.ACCOUNT_PROFILE]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.TELEMETRY_UPLOAD]: FeatureRequirement.ONLINE_OPTIONAL,
  [Feature.STATISTICS_CONTRIBUTION]: FeatureRequirement.ONLINE_OPTIONAL,
  [Feature.BACKGROUND_SYNC]: FeatureRequirement.ONLINE_OPTIONAL,
})

/** 未注册功能的判定：fail-closed（绝不给未知能力发放「可用」）。 */
export const UNKNOWN_FEATURE_REASON = 'unknown-feature'

/** 在线部分被跳过的提示 key（ONLINE_OPTIONAL 离线 / 不可达时使用）。 */
export const SYNC_PAUSED_MESSAGE_KEY = 'featureOffline.syncPaused'

export function featureRequirement(feature) {
  return REQUIREMENTS[feature] ?? null
}

export function isKnownFeature(feature) {
  return Object.prototype.hasOwnProperty.call(REQUIREMENTS, feature)
}

export function featuresByRequirement(requirement) {
  return Object.keys(REQUIREMENTS).filter(feature => REQUIREMENTS[feature] === requirement)
}

/**
 * 统一可用性判定（计划 §2 的 API）。
 *
 * ```js
 * getFeatureAvailability('aiReview', { connectivity: 'offline' })
 * // → { feature, requirement: 'online-required', available: false,
 * //     reason: 'offline', online: false, messageKey: 'featureOffline.aiReview' }
 * ```
 *
 * 规则（对应计划 §29 的确定性矩阵）：
 *  - LOCAL：任何连通性下都 available，`reason: null`（离线不是错误）；
 *  - ONLINE_REQUIRED：仅在线可用；不可用时 `reason` 保留真实状态（offline / degraded / unknown…），
 *    `messageKey = featureOffline.<feature>`；
 *  - ONLINE_OPTIONAL：本地动作始终 available，`online` 表达「联网部分能否进行」（false ⇒ sync 暂停），
 *    离线时 `messageKey = featureOffline.syncPaused`；
 *  - 未知功能：fail-closed（available=false, reason='unknown-feature'）。
 *
 * `degraded` / `service-unavailable` / `unknown` 一律**不**算在线（`isOnlineState`），
 * 因此不会对着一个不可达的服务发请求。
 */
export function getFeatureAvailability(feature, { connectivity = ConnectivityState.UNKNOWN } = {}) {
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
    })
  }

  if (requirement === FeatureRequirement.ONLINE_OPTIONAL) {
    return Object.freeze({
      feature,
      requirement,
      available: true,
      reason: online ? null : state,
      online,
      messageKey: online ? null : SYNC_PAUSED_MESSAGE_KEY,
    })
  }

  return Object.freeze({
    feature,
    requirement,
    available: online,
    reason: online ? null : state,
    online,
    messageKey: online ? null : `featureOffline.${feature}`,
  })
}
