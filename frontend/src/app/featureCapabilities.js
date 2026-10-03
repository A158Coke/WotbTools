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
  SHOOTING_INSPECTION: 'shootingInspection',
  REPLAY_HISTORY: 'replayHistory',
  AI_REVIEW: 'aiReview',
  HALL_OF_FAME: 'hallOfFame',
  PLAYBACK_3D: 'playback3d',
  ACCOUNT_PROFILE: 'accountProfile',
  ADMIN_USERS: 'adminUsers',
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
  [Feature.SHOOTING_INSPECTION]: FeatureRequirement.LOCAL,
  [Feature.REPLAY_HISTORY]: FeatureRequirement.LOCAL,
  [Feature.AI_REVIEW]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.HALL_OF_FAME]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.PLAYBACK_3D]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.ACCOUNT_PROFILE]: FeatureRequirement.ONLINE_REQUIRED,
  // 用户管理（Admin Users）整页由 Keycloak Admin + 本地 user_profile 组成，没有任何本地数据可降级：
  // 没有 backend 就没有列表、详情与删除，因此是 ONLINE_REQUIRED（入口仍可见，点击给统一提示）。
  [Feature.ADMIN_USERS]: FeatureRequirement.ONLINE_REQUIRED,
  [Feature.TELEMETRY_UPLOAD]: FeatureRequirement.ONLINE_OPTIONAL,
  [Feature.STATISTICS_CONTRIBUTION]: FeatureRequirement.ONLINE_OPTIONAL,
  [Feature.BACKGROUND_SYNC]: FeatureRequirement.ONLINE_OPTIONAL,
})

/** 未注册功能的判定：fail-closed（绝不给未知能力发放「可用」）。 */
export const UNKNOWN_FEATURE_REASON = 'unknown-feature'

/** 在线部分被跳过的提示 key（ONLINE_OPTIONAL 且**确实离线**时使用）。 */
export const SYNC_PAUSED_MESSAGE_KEY = 'featureOffline.syncPaused'

/**
 * 非-offline 的连通性提示文案（连线状态本身有问题，而不是「用户离线」）。
 *
 * 语义区分（review P1）：`unknown` / `degraded` / `service-unavailable` **不能**复用
 * `featureOffline.*`，否则用户会被错误告知「你现在离线」。三者各有自己的 title/body。
 */
export const CONNECTIVITY_NOTICE = Object.freeze({
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

/**
 * 把「真实连通性状态」映射成提示文案（title / body / retry hint）。
 *
 * - `offline`：确实是用户离线 ⇒ 功能专属 body `featureOffline.<feature>`；
 * - `unknown` / `degraded` / `service-unavailable`：连通性未知 / 不稳定 / 服务不可用 ⇒
 *   `connectivityNotice.*`（**不**说「你离线」）；
 * - `online`：没有任何提示（三者全为 null）。
 */
function noticeFor(reason, offlineBodyKey) {
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
 * profile backend 准入的**纯策略**（业务 bootstrap 与浏览器测试替身共用同一实现，避免漂移）。
 *
 * 只有「已认证 + [Feature.ACCOUNT_PROFILE] 可用」才允许访问 profile backend：
 * offline / unknown / degraded / service-unavailable 一律拒绝 —— 后三者不是「用户离线」，
 * 但同样不能对着不可达的服务发请求。
 */
export function profileBackendAllowed({ authInitState, authenticated, connectivity } = {}) {
  if (authInitState !== 'authenticated' || authenticated !== true) return false
  return getFeatureAvailability(Feature.ACCOUNT_PROFILE, { connectivity }).available
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
 *  - ONLINE_REQUIRED：仅在线可用；不可用时 `reason` 保留真实状态，并按状态给出文案：
 *    `offline` → `featureOffline.<feature>`；`unknown` / `degraded` / `service-unavailable`
 *    → `connectivityNotice.*`（三者的 title/body 各不相同，绝不统一说成「你离线」）；
 *  - ONLINE_OPTIONAL：本地动作始终 available，`online` 表达「联网部分能否进行」，文案同规则；
 *  - 未知功能：fail-closed（available=false, reason='unknown-feature'，且**不**伪装成连通性问题）。
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
    // 本地动作照常（available=true），只有联网部分停：提示按**真实**状态措辞，
    // 不能把 unknown/degraded 说成「离线导致同步暂停」。
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
