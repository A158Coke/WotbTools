package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.AssaultBaseStateTransition;
import com.wotb.core.replay.event.RawAssaultBaseUpdate;
import com.wotb.core.replay.event.RawSupremacyBaseUpdate;
import com.wotb.core.replay.event.ReplayEvent;

import java.util.Comparator;
import java.util.List;

/**
 * Reconstructs the proven realtime Assault / Encounter single-base progress from wrapper8.
 *
 * <p><b>判据修正（2026-10-01）。</b>早期受控样本（Neptune，11.20 国服）里进度恰好全部由
 * {@code field1=2} 承载，故曾把 {@code field1==2} 当作进度族判别子。三份独立真实回放证明
 * 那是采样假象——携带 {@code field3} 的族会在 {@code field1=1}/{@code field1=2} 之间切换：
 * Yukon（重力模式，两族交替，锁 f1 丢 16/24 事件）、Winter Malinovka（仅 2，无害）、
 * Naval Frontier（遭遇战，<b>仅 1</b>，锁 f1 丢全部 → 时间线为空）。故 {@code field1} 是
 * "哪一方的进度"（owner/占领方，精确语义未闭合），不是"是否进度族"；进度只认
 * {@code field2==1 && field3 存在}。</p>
 *
 * <p><b>目标存在性判据同样修正。</b>裸初始化对 {@code 1=1,2=1} + {@code 1=2,2=1} 是
 * <b>通用广播</b>，普通对局也会发——62 份真实样本里 Regular 的 Canal、TrainingRoom 的
 * Copperfield/Himmelsdorf、Any 的 Mayan Ruins 等 8 份只发这一对（各 2 个 subtype8 包），
 * 而真实单基地场次发 182 个包（116 次 {@code field4=1} 标志流 + {@code field3} 进度）。
 * 故 {@code hasObjective} 要求目标族发出过<b>裸初始化对以外的</b>字段。</p>
 */
public final class AssaultBaseStateReconstructor {

    private AssaultBaseStateReconstructor() {
    }

    public static List<AssaultBaseStateTransition> reconstruct(final List<ReplayEvent> events) {
        if (events == null || events.isEmpty()) {
            return List.of();
        }
        if (!hasObjective(events)) {
            return List.of();
        }
        return events.stream()
                .filter(RawAssaultBaseUpdate.class::isInstance)
                .map(RawAssaultBaseUpdate.class::cast)
                .filter(AssaultBaseStateReconstructor::isProgressFamily)
                .filter(update -> update.rawField3() != null
                        && update.rawField3() >= 0 && update.rawField3() <= 100)
                .sorted(Comparator.comparingDouble(AssaultBaseStateReconstructor::rawClock)
                        .thenComparingInt(RawAssaultBaseUpdate::sequence))
                .map(update -> new AssaultBaseStateTransition(
                        update.sequence(), update.timestamp(), update.packetType(),
                        update.confidence(),
                        update.rawField3()))
                .toList();
    }

    /**
     * 单基地目标存在性：目标族发出过<b>裸初始化对以外的</b>字段（{@code field3} 或
     * {@code field4}）。只看"族出现过"会把普通对局判成有目标（见类注释）。
     */
    public static boolean hasObjective(final List<ReplayEvent> events) {
        if (events == null || events.stream().anyMatch(RawSupremacyBaseUpdate.class::isInstance)) {
            return false;
        }
        return events.stream().anyMatch(AssaultBaseStateReconstructor::isObjectiveEvidence);
    }

    /**
     * 目标证据：目标族发出裸初始化对以外的字段（原始更新），**或**已重建出的 canonical
     * 迁移。后者只可能由 {@code field3} 存在产生（见 {@link #isProgressFamily}），故同样
     * 证明目标存在——只看原始更新会在"调用方只递 canonical 事件"时误判为无目标。
     */
    private static boolean isObjectiveEvidence(final ReplayEvent event) {
        if (event instanceof AssaultBaseStateTransition) {
            return true;
        }
        if (event instanceof RawAssaultBaseUpdate update) {
            return isObjectiveActivity(update);
        }
        return false;
    }

    /** 单基地族：{@code field2==1} 且 {@code field1 ∈ {1,2}}（field1 = 该方的进度，非族判别子）。 */
    private static boolean isObjectiveFamily(final RawAssaultBaseUpdate update) {
        return (Integer.valueOf(1).equals(update.rawField1())
                        || Integer.valueOf(2).equals(update.rawField1()))
                && Integer.valueOf(1).equals(update.rawField2())
                && update.confidence() == com.wotb.core.replay.event.DecodeConfidence.EXACT;
    }

    /** 进度族 = 单基地族且携带 {@code field3}（0..100 由调用侧再验）。 */
    private static boolean isProgressFamily(final RawAssaultBaseUpdate update) {
        return isObjectiveFamily(update) && update.rawField3() != null;
    }

    /** 目标系统活跃 = 单基地族发出裸初始化对以外的字段。 */
    private static boolean isObjectiveActivity(final RawAssaultBaseUpdate update) {
        return isObjectiveFamily(update)
                && (update.rawField3() != null || update.rawField4() != null);
    }

    private static double rawClock(final RawAssaultBaseUpdate update) {
        return update.timestamp() == null
                ? Double.POSITIVE_INFINITY
                : update.timestamp().rawClockSec();
    }
}
