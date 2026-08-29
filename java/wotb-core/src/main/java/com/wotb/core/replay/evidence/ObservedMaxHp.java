package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.VehicleHitEvent;
import com.wotb.core.replay.facts.HpObservation;
import com.wotb.core.replay.facts.HpObservationKind;
import com.wotb.core.replay.facts.ReplayHpTimeline;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 回放实测血量（type-7 propId=3，u16 LE，含装备/物资加成）与进场满血量 provenance。
 *
 * <p>propId=3 正数 = 当前真实 HP（含装备/物资加成；阵亡到 0、存活不到 0）。但当前代码
 * <b>不证明</b>每个玩家一定在首次受击前广播一次完整初始满血——真实回放 probe
 * （EntryHpProbeTest）显示：绝大多数车辆的 positive 样本要么与首次受击同刻（受击同步、
 * 已掉血）、要么低于 tankopedia base，甚至从未受击的车辆首个样本也低于 base。
 * 因此「整场 max current HP = 初始满血」不成立。</p>
 *
 * <p>契约：{@link #populate} 对每名玩家产出 {@link PlayerResult#entryHpSource} /
 * {@link PlayerResult#entryHp}。{@link EntryHpSource#OBSERVED_EXACT} 需要<b>两个条件同时成立</b>：
 * ① 该账号受击覆盖完整（事件流 observed received 与权威结算 damageReceived 一致，复用
 * {@link com.wotb.core.replay.feature.ObservedDamageCoverage} 的匹配语义）——否则
 * {@code OBSERVED_DAMAGE_IS_PARTIAL}，事件流缺伤害 ≠ 没发生伤害，「首次观测受击的缺席」
 * 不能证明「样本发生时尚未损失 HP」；② 存在严格早于首次受击（或结算确认从未受击）的
 * positive 样本且 ≥ tankopedia base。条件不满足一律 fail closed 到
 * {@link EntryHpSource#BASE_FALLBACK}（只允许 tankopedia base 作 baseline）或
 * {@link EntryHpSource#UNKNOWN}。{@link PlayerResult#observedMaxHp} 保留为
 * 「整场观测最大 current HP（下界 tankopedia base）」的 legacy 语义（供 AI 证据保守使用），
 * 不得当 entry full；本字段仅供 AI 证据保守使用，绝不由它推导播放 UI 的 displayCapacityHp
 *（V2 canonical 由 {@code BattlePlaybackProjector} 从真实可信 Type-7 positive HP 采样
 * 独立取最大值）。</p>
 * <p>注意：{@code first observed DamageEvent} 只能帮助<b>证伪</b>「整场 max current HP ==
 * entry HP」（见 {@code EntryHpProbeTest}），不能独立证明「sample before first observed
 * damage == authoritative initial full HP」。</p>
 */
public final class ObservedMaxHp {

    private ObservedMaxHp() {
    }

    /** 按账号统计回放实测最大血量（统一 HP timeline 中可信正 HP；re-entry 跨实体合并取 max）。
     * 语义 = 整场观测到的最大 current HP，不是进场满血。
     * surface：Type7 prop3 / Type5 物化快照 / Avatar method5 镜像 / Vehicle method1。 */
    public static Map<Long, Integer> byAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        final Map<Long, Integer> observed = new HashMap<>();
        if (events == null) {
            return observed;
        }
        for (final HpObservation hp : ReplayHpTimeline.build(events, mapping, null)) {
            if (!hp.plausible()) {
                continue;
            }
            observed.merge(hp.accountId(), hp.hp(), Math::max);
        }
        return observed;
    }

    /** 幂等回填：观测最大 current HP + 进场满血量 provenance 写入 battle.players（无重建时跳过）。 */
    public static void populate(
            final Battle battle,
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        if (battle == null || battle.players == null || events == null || mapping == null) {
            return;
        }
        final Map<Long, Integer> observed = byAccount(events, mapping);
        final Map<Long, List<HpObservation>> hpTimeline =
                hpTimelineByAccount(events, mapping);
        final Map<Long, Double> firstDamageSec = firstDamageSecByAccount(events, mapping);
        final Map<Long, Integer> observedReceived = observedReceivedByAccount(events, mapping);
        final Long recorderAccountId = PlayerResultFormat.recorderAccountId(battle);
        for (final PlayerResult player : battle.players) {
            if (player == null) {
                continue;
            }
            // observedMaxHp 保留「观测最大 current HP，下界 tankopedia base」legacy 语义：
            // 供 AI 证据保守使用（≥ base，不得低于基础值）。
            // 注意：V2 播放 UI 的 displayCapacityHp 由 BattlePlaybackProjector 从真实 hpSamples
            // 独立产生，绝不使用本字段的 resolve() 钳制/fallback。
            player.observedMaxHp = resolve(observed.get(player.accountId), player.tankId);
            final boolean coverageExact = receivedCoverageExact(player, observedReceived.get(player.accountId));
            resolveEntryHp(player, hpTimeline.get(player.accountId),
                    firstDamageSec.get(player.accountId), coverageExact,
                    recorderAccountId != null && recorderAccountId == player.accountId);
        }
    }

    /**
     * 车辆静态满血事实（provenance-aware，供 AI 车辆 HP 属性/denominator）：
     * OBSERVED_EXACT → 已证明的进场满血（含装备/物资加成）；否则 tankopedia base
     * （BASE baseline，base 是 entry 下界）；均无 → null。整场观测最大 current HP
     * （observedMaxHp）不得冒充满血。
     */
    public static Integer fullMaxHp(final PlayerResult p) {
        if (p.entryHpSource == EntryHpSource.OBSERVED_EXACT
                && p.entryHp != null && p.entryHp > 0) {
            return p.entryHp;
        }
        return ReplayDisplayNames.tankMaxHpValue(p.tankId);
    }

    /** 该账号受击覆盖是否完整：事件流 observed received 与权威结算一致（复用 ObservedDamageCoverage 匹配语义）。 */
    private static boolean receivedCoverageExact(final PlayerResult p, final Integer observedReceived) {
        final int authoritative = p.damageReceived;
        if (authoritative <= 0) {
            return observedReceived == null || observedReceived == 0;
        }
        return observedReceived != null && observedReceived == authoritative;
    }

    /** 观测最大血量解析（legacy AI 语义，保留）：max(回放实测, tankopedia base)；均无 → null。
     * 仅供 AI 证据保守使用；V2 播放 UI 的 displayCapacityHp 不经过本方法。 */
    public static Integer resolve(final Integer observed, final long tankId) {
        final Integer base = ReplayDisplayNames.tankMaxHpValue(tankId);
        if (observed == null) {
            return base;
        }
        if (base == null) {
            return observed;
        }
        return Math.max(observed, base);
    }

    /**
     * 判定进场满血量 provenance 并回填 player.entryHpSource / player.entryHp。
     * 当前 HP 单调非增（无治疗）：首个 positive 样本即整场最大值。
     * <p>OBSERVED_EXACT 需要受击覆盖完整（coverageExact）——否则事件流缺伤害 ≠ 没发生伤害，
     * 「样本早于首次观测受击」不能证明「样本发生时尚未损失 HP」，一律 fail closed。</p>
     */
    private static void resolveEntryHp(final PlayerResult player,
                                       final List<HpObservation> samples,
                                       final Double firstDamageSec,
                                       final boolean coverageExact,
                                       final boolean recorder) {
        final Integer base = ReplayDisplayNames.tankMaxHpValue(player.tankId);
        player.entryHpSource = null;
        player.entryHp = null;
        if (samples == null || samples.isEmpty()) {
            player.entryHpSource = base != null ? EntryHpSource.BASE_FALLBACK : EntryHpSource.UNKNOWN;
            return;
        }
        // 录像者 AFFIRMED opening HP（docs/research/replay/avatar-method5-own-health.md）：
        // Avatar method5 初始化值 = opening HP 种子（34/34 == 首个 recorder Type5 hpRaw；
        // 即使 opening HP != tankopedia base 也成立）。只要求该种子严格早于首次受击
        // （opening seed 必然在开战前），不需要 damage coverage —— own-health mirror 是
        // 客户端直接权威，不受事件流受击覆盖完整性影响。
        if (recorder) {
            final HpObservation opening = samples.stream()
                    .filter(HpObservation::plausible)
                    .filter(s -> s.kind() == HpObservationKind.RECORDER_HP_MIRROR
                            || s.kind() == HpObservationKind.MATERIALIZATION_HP)
                    .filter(s -> beforeFirstDamage(s.timeSec(), firstDamageSec))
                    .min(java.util.Comparator.comparingDouble(HpObservation::timeSec))
                    .orElse(null);
            if (opening != null) {
                player.entryHpSource = EntryHpSource.OBSERVED_EXACT;
                player.entryHp = opening.hp();
                return;
            }
        }
        if (!coverageExact) {
            // 受击覆盖 PARTIAL/UNKNOWN：不得仅凭「首次观测受击的缺席」判受击前满血
            player.entryHpSource = base != null ? EntryHpSource.BASE_FALLBACK : EntryHpSource.UNKNOWN;
            return;
        }
        final HpObservation firstPlausible = samples.stream()
                .filter(HpObservation::plausible)
                .min(java.util.Comparator.comparingDouble(HpObservation::timeSec))
                .orElse(null);
        if (firstPlausible == null) {
            player.entryHpSource = base != null ? EntryHpSource.BASE_FALLBACK : EntryHpSource.UNKNOWN;
            return;
        }
        final double firstSampleTime = firstPlausible.timeSec();
        final int firstSampleHp = firstPlausible.hp();
        // 覆盖完整时 firstDamageSec 可靠：受击前（或结算确认从未受击）的首个样本 = 当时满血；
        // 且 ≥ tankopedia base 才可证明为 initial full（base 是 entry 下界）。
        if (beforeFirstDamage(firstSampleTime, firstDamageSec) && base != null
                && firstSampleHp >= base) {
            player.entryHpSource = EntryHpSource.OBSERVED_EXACT;
            player.entryHp = firstSampleHp;
            return;
        }
        player.entryHpSource = base != null ? EntryHpSource.BASE_FALLBACK : EntryHpSource.UNKNOWN;
    }

    private static boolean beforeFirstDamage(final double sampleTime, final Double firstDamageSec) {
        return firstDamageSec == null || sampleTime < firstDamageSec - 1e-6;
    }

    /**
     * 每账号受击总量（权威 HP loss 口径，用于覆盖判定）：
     * Type-8 rawProtocolValue 语义未证明，不得作为「事件流 received」与结算比较；
     * 只有连续可信 Type-7 propId=3 掉血（含阵亡到 0）才反映真实承受伤害。
     */
    private static Map<Long, Integer> observedReceivedByAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        final Map<Long, Integer> out = new HashMap<>();
        if (events == null || mapping == null) {
            return out;
        }
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat =
                com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                        events, mapping, 0.0, Double.MAX_VALUE);
        for (final java.util.Map.Entry<Long,
                List<com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss>> entry
                : combat.lossesByVictim().entrySet()) {
            int total = 0;
            for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss l
                    : entry.getValue()) {
                total += l.hpLoss();
            }
            out.put(entry.getKey(), total);
        }
        return out;
    }

    /** 每账号 HP 观测时间线（统一 surface；battle-relative 秒升序；re-entry 跨实体合并）。 */
    private static Map<Long, List<HpObservation>> hpTimelineByAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        final Map<Long, List<HpObservation>> out = new HashMap<>();
        if (events == null) {
            return out;
        }
        for (final HpObservation hp : ReplayHpTimeline.build(events, mapping, null)) {
            if (hp.accountId() <= 0) {
                continue;
            }
            out.computeIfAbsent(hp.accountId(), k -> new ArrayList<>()).add(hp);
        }
        out.values().forEach(list -> list.sort(
                java.util.Comparator.comparingDouble(HpObservation::timeSec)));
        return out;
    }

    /** 每账号首次受击时间（battle-relative 秒；无受击事件 → null）。 */
    private static Map<Long, Double> firstDamageSecByAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        final Map<Long, Double> out = new HashMap<>();
        if (events == null || mapping == null) {
            return out;
        }
        for (final ReplayEvent event : events) {
            // method8 is a hit/result-feedback family (VehicleHitEvent), not a damage number;
            // a hit on the victim is engagement signal regardless of the old fabricated damage value.
            final int victimEid;
            if (event instanceof VehicleHitEvent hit && hit.confidence() == DecodeConfidence.EXACT) {
                victimEid = hit.victimEntityId();
            } else if (event instanceof DamageEvent damage && damage.damage() > 0) {
                victimEid = damage.victimEid();
            } else {
                continue;
            }
            final TeamEntityIdentity identity = mapping.identity(victimEid);
            if (identity == null || identity.accountId() <= 0) {
                continue;
            }
            final double t = relativeSec(event);
            out.merge(identity.accountId(), t, Math::min);
        }
        return out;
    }

    private static double relativeSec(final ReplayEvent e) {
        if (e.timestamp() == null) {
            return 0;
        }
        final Float battle = e.timestamp().battleClockSec();
        if (battle != null) {
            return battle;
        }
        return e.timestamp().rawClockSec();
    }
}
