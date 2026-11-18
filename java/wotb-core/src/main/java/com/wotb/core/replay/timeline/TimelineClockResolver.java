package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;


/** Resolves the battle-relative clock and active-battle duration used by the canonical timeline. */
final class TimelineClockResolver {
    /** 防御性帧数上限（450s 战斗约 451 帧；超长异常拒绝而非 OOM）。 */
    static final int MAX_FRAMES = 2400;
    /** active-battle 时长上限，与已退役 Java ReplayParser 的 durationS cap 同口径。 */
    static final double MAX_BATTLE_DURATION_SEC = 420.0;

    private TimelineClockResolver() {
    }

    // ===== clock / duration =====

    record ClockResult(double startRawClockSec, BattleTimelineClock resolution) {
    }

    static ClockResult resolveClock(final Battle battle, final ReplayReconstruction recon) {
        final Float start = recon.battleStartRawClockSec();
        if (start != null && Float.isFinite(start)) {
            return new ClockResult(start, BattleTimelineClock.IDENTIFIED);
        }
        // 事件自带 battle-relative 时钟（未来 decoder 支持时）：仅当时钟域一致（全部携带
        // battleClockSec）才以 0 为基准；混合域（部分带、部分 raw-only）会混用两个时钟域，
        // 拒绝 0 基准、落到 ESTIMATED（raw 域统一），并在 build 阶段标记 MIXED_CLOCK_DOMAINS。
        boolean anyBattleClock = false;
        boolean anyRawOnly = false;
        for (final ReplayEvent e : recon.events()) {
            if (e.timestamp() == null) {
                continue;
            }
            if (e.timestamp().battleClockSec() != null) {
                anyBattleClock = true;
            } else {
                anyRawOnly = true;
            }
        }
        if (anyBattleClock && !anyRawOnly) {
            return new ClockResult(0d, BattleTimelineClock.IDENTIFIED);
        }
        if (battle != null && battle.durationS != null
                && Float.isFinite(battle.durationS.floatValue()) && battle.durationS > 0) {
            for (final ReplayEvent e : recon.events()) {
                if (e instanceof RoundFinishedEvent be && be.timestamp() != null) {
                    final float raw = be.timestamp().rawClockSec();
                    if (Float.isFinite(raw) && raw >= 0) {
                        final double estimatedStart = raw - battle.durationS.doubleValue();
                        if (estimatedStart >= 0) {
                            return new ClockResult(estimatedStart, BattleTimelineClock.ESTIMATED);
                        }
                        break;
                    }
                }
            }
            // The battle-start is resolved once upstream of the timeline (originally
            // ReplayReconstructionService — historical Java implementation, retired 2026-10-02 with the
            // server-side parser; the client side derives it from the upstream Rust Core WASM parseResult /
            // canonical facts, incl. an ESTIMATED lastClock - duration fallback), so
            // recon.battleStartRawClockSec is the single agreed start; the timeline reuses it directly
            // (IDENTIFIED) and never derives a different one.
        }
        return new ClockResult(Double.NaN, BattleTimelineClock.UNRESOLVED);
    }

    /**
     * Timeline/playback active-battle 时长权威链（docs/features/battle-playback.md「时长契约」）：
     * <ol>
     *   <li>battle_results root5 {@code settlementDurationSec}（权威；cap 420s，与已退役 Java
     *       {@code ReplayParser} 同口径）；</li>
     *   <li>{@code RoundFinishedEvent}（method4 = AFTERBATTLE）battle-relative 时间，即
     *       round-finished rawClock − battle-period 开始 rawClock（finite &gt; 0；cap 420s）；</li>
     *   <li>legacy {@code battle.durationS}（无 settlement 时来自 meta.json#battleDuration，cap 420s）——
     *       meta battleDuration 不是可靠的 active-battle 时钟（battle-results.md root5），
     *       常比真实战斗长，导致进度条在战斗结束时只走到一半，故排在 round-finished 之后；</li>
     *   <li>最后一个有限事件时间（battle-relative）。</li>
     * </ol>
     * <p>由于 ② 严格优先于 ③，任何「meta 比 round-finished 长出明显余量」的情况都自然取 round-finished；
     * {@link #roundFinishedBattleSec} 不可用时才落到 meta。</p>
     */
    static double resolveDurationSec(
            final Battle battle, final ReplayReconstruction recon, final double startRawClockSec) {
        // ① settlement root5：权威战斗时长
        if (battle != null && isPositiveFinite(battle.settlementDurationSec)) {
            return Math.min(battle.settlementDurationSec, MAX_BATTLE_DURATION_SEC);
        }
        // ② round-finished − battle 开始：事件流实测的真实结束时刻
        final double roundFinished = roundFinishedBattleSec(recon, startRawClockSec);
        if (roundFinished > 0) {
            return Math.min(roundFinished, MAX_BATTLE_DURATION_SEC);
        }
        // ③ legacy durationS（meta.json#battleDuration）
        if (battle != null && isPositiveFinite(battle.durationS)) {
            return Math.min(battle.durationS, MAX_BATTLE_DURATION_SEC);
        }
        // ④ 最后事件时间
        double max = 0d;
        for (final ReplayEvent e : recon.events()) {
            final double t = TimelineClock.battleClockOf(e, startRawClockSec);
            if (Double.isFinite(t) && t > max) {
                max = t;
            }
        }
        return max;
    }

    /**
     * 第一个合法 {@code RoundFinishedEvent} 的 battle-relative 时间（秒）；无事件 / 时间戳非有限 /
     * 不晚于 battle 开始时返回 {@link Double#NaN}。
     */
    static double roundFinishedBattleSec(
            final ReplayReconstruction recon, final double startRawClockSec) {
        if (recon == null || recon.events() == null || !Double.isFinite(startRawClockSec)) {
            return Double.NaN;
        }
        for (final ReplayEvent e : recon.events()) {
            if (e instanceof RoundFinishedEvent) {
                final double t = TimelineClock.battleClockOf(e, startRawClockSec);
                if (Double.isFinite(t) && t > 0) {
                    return t;
                }
            }
        }
        return Double.NaN;
    }

    private static boolean isPositiveFinite(final Double value) {
        return value != null && Double.isFinite(value) && value > 0;
    }

}
