import { describe, expect, it } from 'vitest'
import { ConnectivityState } from '../platform/connectivity.js'
import { messages } from '../locales/messages.js'
import {
  Feature,
  FeatureRequirement,
  SYNC_PAUSED_MESSAGE_KEY,
  UNKNOWN_FEATURE_REASON,
  featureRequirement,
  featuresByRequirement,
  getFeatureAvailability,
  isKnownFeature,
} from './featureCapabilities.js'

/**
 * capability 模型的确定性矩阵（计划 §29）：测**判定**，不测文案。
 *
 * 这是「离线是受支持的运行模式」这条产品约定的可执行形式：本地球功能任何情况下可用，
 * 联网功能在离线时**立刻**不可用（不给「先等超时再说」留任何空间）。
 */
describe('feature capability model', () => {
  const offline = { connectivity: ConnectivityState.OFFLINE }
  const online = { connectivity: ConnectivityState.ONLINE }

  it('LOCAL + offline → available', () => {
    for (const feature of featuresByRequirement(FeatureRequirement.LOCAL)) {
      const availability = getFeatureAvailability(feature, offline)
      expect(availability.available, feature).toBe(true)
      expect(availability.reason, feature).toBeNull()
      expect(availability.messageKey, feature).toBeNull()
    }
  })

  it('ONLINE_REQUIRED + offline → unavailable(reason=offline) with a tip key', () => {
    for (const feature of featuresByRequirement(FeatureRequirement.ONLINE_REQUIRED)) {
      const availability = getFeatureAvailability(feature, offline)
      expect(availability.available, feature).toBe(false)
      expect(availability.reason, feature).toBe(ConnectivityState.OFFLINE)
      expect(availability.requirement, feature).toBe(FeatureRequirement.ONLINE_REQUIRED)
      expect(availability.messageKey, feature).toBe(`featureOffline.${feature}`)
      expect(availability.online, feature).toBe(false)
    }
  })

  it('ONLINE_REQUIRED + online → available', () => {
    for (const feature of featuresByRequirement(FeatureRequirement.ONLINE_REQUIRED)) {
      const availability = getFeatureAvailability(feature, online)
      expect(availability.available, feature).toBe(true)
      expect(availability.reason, feature).toBeNull()
      expect(availability.messageKey, feature).toBeNull()
    }
  })

  it('ONLINE_OPTIONAL + offline → local action available, sync disabled', () => {
    for (const feature of featuresByRequirement(FeatureRequirement.ONLINE_OPTIONAL)) {
      const availability = getFeatureAvailability(feature, offline)
      expect(availability.available, feature).toBe(true)
      expect(availability.online, feature).toBe(false)
      expect(availability.reason, feature).toBe(ConnectivityState.OFFLINE)
      expect(availability.messageKey, feature).toBe(SYNC_PAUSED_MESSAGE_KEY)
    }
  })

  it('ONLINE_OPTIONAL + online → sync enabled', () => {
    for (const feature of featuresByRequirement(FeatureRequirement.ONLINE_OPTIONAL)) {
      const availability = getFeatureAvailability(feature, online)
      expect(availability.available, feature).toBe(true)
      expect(availability.online, feature).toBe(true)
      expect(availability.messageKey, feature).toBeNull()
    }
  })

  it('offline → online flips the same feature without recreating the model', () => {
    const before = getFeatureAvailability(Feature.AI_REVIEW, offline)
    const after = getFeatureAvailability(Feature.AI_REVIEW, online)
    expect(before.available).toBe(false)
    expect(after.available).toBe(true)
    expect(before.requirement).toBe(after.requirement)
  })

  it('online → offline flips back (local features never depend on it)', () => {
    const resultOffline = getFeatureAvailability(Feature.REPLAY_RESULT, offline)
    const aiOffline = getFeatureAvailability(Feature.AI_REVIEW, { connectivity: ConnectivityState.ONLINE })
    expect(aiOffline.available).toBe(true)
    expect(resultOffline.available).toBe(true)
    expect(getFeatureAvailability(Feature.AI_REVIEW, offline).available).toBe(false)
  })

  it('reserved/unknown connectivity states are never treated as online', () => {
    for (const state of [
      ConnectivityState.DEGRADED,
      ConnectivityState.SERVICE_UNAVAILABLE,
      ConnectivityState.UNKNOWN,
      'nonsense',
      undefined,
      null,
    ]) {
      const ai = getFeatureAvailability(Feature.AI_REVIEW, { connectivity: state })
      expect(ai.available, String(state)).toBe(false)
      expect(ai.online, String(state)).toBe(false)
      // 本地功能不受影响：连通性判断永远不能锁死本地能力。
      expect(getFeatureAvailability(Feature.RATING, { connectivity: state }).available, String(state)).toBe(true)
    }
  })

  it('maps each non-online reason to its own copy (never calls unknown/degraded "offline")', () => {
    // offline：确实是用户离线 ⇒ 功能专属文案 + 「你现在离线」标题
    const offline = getFeatureAvailability(Feature.AI_REVIEW, { connectivity: ConnectivityState.OFFLINE })
    expect(offline.reason).toBe(ConnectivityState.OFFLINE)
    expect(offline.messageKey).toBe('featureOffline.aiReview')
    expect(offline.titleKey).toBe('featureOffline.title')
    expect(offline.hintKey).toBe('featureOffline.retry')

    const expected = [
      [ConnectivityState.UNKNOWN, 'connectivityNotice.unknown', 'connectivityNotice.unknownTitle'],
      [ConnectivityState.DEGRADED, 'connectivityNotice.degraded', 'connectivityNotice.degradedTitle'],
      [ConnectivityState.SERVICE_UNAVAILABLE, 'connectivityNotice.serviceUnavailable', 'connectivityNotice.serviceUnavailableTitle'],
    ]
    const keys = new Set([offline.messageKey])
    for (const [state, messageKey, titleKey] of expected) {
      const availability = getFeatureAvailability(Feature.AI_REVIEW, { connectivity: state })
      expect(availability.reason, state).toBe(state)
      expect(availability.messageKey, state).toBe(messageKey)
      expect(availability.titleKey, state).toBe(titleKey)
      expect(availability.hintKey, state).toBe('connectivityNotice.retry')
      keys.add(availability.messageKey)
    }
    // 四个 reason 四套文案：绝不允许全部落到同一个 offline key。
    expect(keys.size).toBe(4)
  })

  it('ONLINE_OPTIONAL follows the same reason mapping for its online part', () => {
    const offline = getFeatureAvailability(Feature.TELEMETRY_UPLOAD, { connectivity: ConnectivityState.OFFLINE })
    expect(offline.available).toBe(true)
    expect(offline.online).toBe(false)
    expect(offline.messageKey).toBe(SYNC_PAUSED_MESSAGE_KEY)
    expect(offline.titleKey).toBe('featureOffline.title')

    const unknown = getFeatureAvailability(Feature.TELEMETRY_UPLOAD, { connectivity: ConnectivityState.UNKNOWN })
    expect(unknown.available).toBe(true)
    expect(unknown.online).toBe(false)
    expect(unknown.messageKey).toBe('connectivityNotice.unknown')
    expect(unknown.titleKey).toBe('connectivityNotice.unknownTitle')

    const online = getFeatureAvailability(Feature.TELEMETRY_UPLOAD, { connectivity: ConnectivityState.ONLINE })
    expect(online.online).toBe(true)
    expect(online.messageKey).toBeNull()
    expect(online.titleKey).toBeNull()
  })

  it('an unregistered feature is fail-closed', () => {
    const availability = getFeatureAvailability('not-a-feature', online)
    expect(availability.available).toBe(false)
    expect(availability.reason).toBe(UNKNOWN_FEATURE_REASON)
    expect(availability.requirement).toBeNull()
    // 未知功能不是连通性问题：不得伪装成 connectivity 文案。
    expect(availability.messageKey).toBeNull()
    expect(availability.titleKey).toBeNull()
    expect(isKnownFeature('not-a-feature')).toBe(false)
    expect(featureRequirement('not-a-feature')).toBeNull()
  })

  it('classifies the PR B feature set exactly once (no page-local lists)', () => {    expect(featureRequirement(Feature.AI_REVIEW)).toBe(FeatureRequirement.ONLINE_REQUIRED)
    expect(featureRequirement(Feature.HALL_OF_FAME)).toBe(FeatureRequirement.ONLINE_REQUIRED)
    expect(featureRequirement(Feature.PLAYBACK_3D)).toBe(FeatureRequirement.ONLINE_REQUIRED)
    expect(featureRequirement(Feature.ACCOUNT_PROFILE)).toBe(FeatureRequirement.ONLINE_REQUIRED)
    expect(featureRequirement(Feature.ADMIN_USERS)).toBe(FeatureRequirement.ONLINE_REQUIRED)
    expect(featureRequirement(Feature.PLAYBACK_2D)).toBe(FeatureRequirement.LOCAL)
    expect(featureRequirement(Feature.SHOOTING_INSPECTION)).toBe(FeatureRequirement.LOCAL)
    expect(featureRequirement(Feature.RATING)).toBe(FeatureRequirement.LOCAL)
    expect(featureRequirement(Feature.REPLAY_PARSING)).toBe(FeatureRequirement.LOCAL)
    expect(featureRequirement(Feature.TELEMETRY_UPLOAD)).toBe(FeatureRequirement.ONLINE_OPTIONAL)
  })
})

/**
 * capability 模型给出的每个 messageKey 必须真的能翻译出来。
 *
 * 这条断言的存在理由（PR 467 review P1）：新增 `Feature.ADMIN_USERS` 时如果只注册需求而不补
 * `featureOffline.adminUsers`，门禁会显示一个裸 key（或空白提示）—— 而 capability 测试本身
 * 只断言 key 存在，不会发现翻译缺失。这里把「注册表」与「三语 locale」钉在一起。
 */
describe('capability message keys resolve in every locale', () => {
  const states = [
    ConnectivityState.OFFLINE,
    ConnectivityState.UNKNOWN,
    ConnectivityState.DEGRADED,
    ConnectivityState.SERVICE_UNAVAILABLE,
  ]

  function lookup(locale, key) {
    return key.split('.').reduce((node, part) => (node ? node[part] : undefined), messages[locale])
  }

  it('every feature availability key has zh/en/ru copy', () => {
    const features = Object.values(Feature)
    for (const state of states) {
      for (const feature of features) {
        const { messageKey, titleKey, hintKey } = getFeatureAvailability(feature, { connectivity: state })
        for (const key of [messageKey, titleKey, hintKey]) {
          if (!key) continue
          for (const locale of ['zh', 'en', 'ru']) {
            expect(lookup(locale, key), `${locale} ${feature} @${state} → ${key}`).toBeTruthy()
          }
        }
      }
    }
  })

  it('every ONLINE_REQUIRED feature has its own offline copy (never a bare key)', () => {
    for (const feature of featuresByRequirement(FeatureRequirement.ONLINE_REQUIRED)) {
      for (const locale of ['zh', 'en', 'ru']) {
        expect(lookup(locale, `featureOffline.${feature}`), `${locale} featureOffline.${feature}`).toBeTruthy()
      }
    }
    // 每个功能一份文案：拿掉任何一个功能的离线说明都必须让本用例失败。
    const offlineCopy = featuresByRequirement(FeatureRequirement.ONLINE_REQUIRED)
      .map(feature => lookup('zh', `featureOffline.${feature}`))
    expect(new Set(offlineCopy).size).toBe(offlineCopy.length)
  })
})
