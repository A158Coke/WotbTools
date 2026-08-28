package com.wotb.core.replay.facts;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.RecorderHealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 统一 HP canonical timeline（计划 §B4/B5）。
 *
 * <p>整合 surface：Type5 materialization（MATERIALIZATION_HP）、Avatar method5
 * （RECORDER_HP_MIRROR）、Vehicle Type7 propId=3（CURRENT_HP / TERMINAL_ZERO /
 * TERMINAL_SENTINEL）、Vehicle method1（METHOD1_HP）、settlement cross-check
 * （{@link #settlementInitialHp}）。</p>
 *
 * <p>生产规则（§B5）：录像者 opening HP 可被 method5/首个 Type5 快照 AFFIRMED；
 * 盟友 opening chain 可证明 OBSERVED_EXACT；敌方首次物化前可能已掉血，first observed
 * HP 只是 AFFIRMED current HP，不是 guaranteed starting max——必须 fail closed。</p>
 */
public final class ReplayHpTimeline {

    private ReplayHpTimeline() {
    }

    /**
     * 构建统一 HP 观测时间线（battle-relative 秒升序；事件顺序同 sequence）。
     *
     * @param events 全部领域事件
     * @param mapping entity→account 映射（可为 null；未映射实体 accountId=0）
     * @param startRawClockSec battle start 原始时钟（battle-relative 换算；可为 NaN）
     */
    public static List<HpObservation> build(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final Double startRawClockSec) {
        final List<HpObservation> out = new ArrayList<>();
        if (events == null) {
            return out;
        }
        for (final ReplayEvent event : events) {
            final double t = eventTime(event, startRawClockSec);
            if (!Double.isFinite(t)) {
                continue;
            }
            switch (event) {
                case HealthChangedEvent h -> {
                    final long account = accountOf(mapping, h.entityId());
                    if (h.confidence() == DecodeConfidence.EXACT && h.currentHealth() != null) {
                        final int hp = h.currentHealth();
                        final HpObservationKind kind;
                        if (hp > 0 && hp < 0xFF00) {
                            kind = HpObservationKind.CURRENT_HP;
                        } else if (hp == 0) {
                            kind = HpObservationKind.TERMINAL_ZERO;
                        } else {
                            kind = HpObservationKind.TERMINAL_SENTINEL;
                        }
                        out.add(new HpObservation(h.entityId(), account, t, hp, kind,
                                ReplayFactSource.OBSERVED_EXACT));
                    }
                }
                case MaterializationEvent m -> {
                    if (m.currentHp() != null && m.confidence() == DecodeConfidence.EXACT) {
                        out.add(new HpObservation(m.entityId(), accountOf(mapping, m.entityId()),
                                t, m.currentHp(), HpObservationKind.MATERIALIZATION_HP,
                                ReplayFactSource.OBSERVED_EXACT));
                    }
                }
                case RecorderHealthChangedEvent r -> out.add(new HpObservation(
                        r.entityId(), accountOf(mapping, r.entityId()), t, r.currentHp(),
                        HpObservationKind.RECORDER_HP_MIRROR, ReplayFactSource.OBSERVED_EXACT));
                case VehicleHealthStateEvent v -> {
                    if (v.confidence() == DecodeConfidence.EXACT) {
                        out.add(new HpObservation(v.entityId(), accountOf(mapping, v.entityId()),
                                t, v.currentHpRaw(), HpObservationKind.METHOD1_HP,
                                ReplayFactSource.OBSERVED_EXACT));
                    }
                }
                default -> {
                    // 其它事件不影响 HP 时间线
                }
            }
        }
        out.sort(Comparator.comparingDouble(HpObservation::timeSec)
                .thenComparingInt(HpObservation::entityId));
        return List.copyOf(out);
    }

    /**
     * 结算交叉验证：settlement-derived initial actual HP（research
     * actual-hp-type5-settlement.md）：{@code max(signed field1, 0) + field11(damageReceived)}。
     *
     * <p>field1 从 {@link PlayerResult#raw} 读取（signed i32 语义；负数 = terminal sentinel，
     * 归零参与）；raw 缺失时退回 {@code damageReceived}（无法还原存活者的剩余 HP）。</p>
     *
     * <p>仅用于交叉验证/诊断；生产 entry-HP 规则按 §B5（recorder/ally 证据链，enemy fail-closed），
     * 结算推导不得成为 enemy opening HP 的自动来源。</p>
     */
    public static Integer settlementInitialHp(final PlayerResult player) {
        if (player == null) {
            return null;
        }
        final Integer signedField1 = signedField1(player);
        final int finalHp = signedField1 == null ? 0 : Math.max(signedField1, 0);
        final int damageReceived = Math.max(player.damageReceived, 0);
        if (signedField1 == null && player.damageReceived <= 0) {
            return null;
        }
        return finalHp + damageReceived;
    }

    private static Integer signedField1(final PlayerResult player) {
        final var raw = player.raw;
        if (raw == null) {
            return null;
        }
        final List<Object> values = raw.get(1);
        if (values == null || values.isEmpty()) {
            return null;
        }
        final Object v = values.get(0);
        if (v instanceof Integer i) {
            return i;
        }
        if (v instanceof Long l) {
            return (int) (long) l;
        }
        return null;
    }

    private static double eventTime(final ReplayEvent e, final Double startRawClockSec) {
        if (e.timestamp() == null) {
            return Double.NaN;
        }
        final Float battle = e.timestamp().battleClockSec();
        if (battle != null && Float.isFinite(battle)) {
            return battle;
        }
        if (startRawClockSec == null || !Double.isFinite(startRawClockSec)) {
            // 无 battle start：退回 raw 时钟（与 ObservedMaxHp.relativeSec 旧语义一致）
            return e.timestamp().rawClockSec();
        }
        return e.timestamp().rawClockSec() - startRawClockSec;
    }

    private static long accountOf(final TeamEntityMapping mapping, final int entityId) {
        if (mapping == null) {
            return 0;
        }
        final TeamEntityIdentity identity = mapping.identity(entityId);
        return identity != null && identity.accountId() > 0 ? identity.accountId() : 0;
    }
}
