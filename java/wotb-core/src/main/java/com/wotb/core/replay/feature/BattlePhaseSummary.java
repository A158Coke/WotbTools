package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.List;

public record BattlePhaseSummary(
        float startTime,
        float endTime,
        BattlePhaseType type,
        DecodeConfidence confidence,
        Integer friendlyAlive,
        Integer enemyAlive,
        boolean denseKills
) {
    public BattlePhaseSummary {
        if (!Float.isFinite(startTime)) throw new IllegalArgumentException("startTime must be finite");
        if (!Float.isFinite(endTime)) throw new IllegalArgumentException("endTime must be finite");
        if (startTime < 0) throw new IllegalArgumentException("startTime must be >= 0: " + startTime);
        if (endTime < 0) throw new IllegalArgumentException("endTime must be >= 0: " + endTime);
        if (startTime > endTime) throw new IllegalArgumentException("startTime > endTime: " + startTime + " > " + endTime);
        if (type == null) throw new IllegalArgumentException("type must not be null");
        if (confidence == null) confidence = DecodeConfidence.UNKNOWN;
        if (friendlyAlive != null && friendlyAlive < 0) {
            throw new IllegalArgumentException("friendlyAlive must be >= 0: " + friendlyAlive);
        }
        if (enemyAlive != null && enemyAlive < 0) {
            throw new IllegalArgumentException("enemyAlive must be >= 0: " + enemyAlive);
        }
    }

    /** 无存活人数信息的阶段（现有调用方与测试保持原行为）。 */
    public BattlePhaseSummary(
            final float startTime,
            final float endTime,
            final BattlePhaseType type,
            final DecodeConfidence confidence
    ) {
        this(startTime, endTime, type, confidence, null, null, false);
    }

    // ---- Shared constants for phase building ----

    public static final float OPENING_DURATION = 45f;
    public static final float UNKNOWN_FIRST_CONTACT = -1f;
    static final float FIRST_CONTACT_DURATION = 10f;
    static final float MID_GAME_MIN_DURATION = 60f;

    /** 密集击杀窗口判定：窗口宽度（秒）。 */
    public static final float DENSE_KILL_WINDOW_SEC = 15f;
    /** 密集击杀窗口判定：窗口内（双方合计）至少的阵亡数。 */
    public static final int MIN_DENSE_KILLS = 3;

    /**
     * 死亡时刻来源标签（数据口径诚实）：全部阵亡玩家都有 battle_results 的
     * deathTimeMillis（>0）时返回「权威结算」；结算缺少死亡时刻字段、但事件流
     * fallback 最终估出时间（deathSec>0）时返回「事件流估算」；存在任意阵亡玩家
     * 最终 deathSec<=0（时刻未知）时返回「未知」。无阵亡玩家时返回「权威结算」。
     */
    public static String deathSourceLabel(final Battle battle) {
        if (battle == null || battle.players == null) {
            return "未知";
        }
        boolean anyDead = false;
        boolean anyNonAuthoritative = false;
        for (final PlayerResult p : battle.players) {
            if (!PlayerSideResolver.isValidRawTeam(p.team) || p.survived) {
                continue;
            }
            anyDead = true;
            if (p.deathTimeMillis <= 0) {
                anyNonAuthoritative = true;
                if (PlayerResultFormat.deathSec(p) <= 0) {
                    return "未知";
                }
            }
        }
        return !anyDead || !anyNonAuthoritative ? "权威结算" : "事件流估算";
    }

    /**
     * Build battle-relative phases.
     * <p>
     * Time semantics (all battle-relative seconds, battle start = 0):
     * <ul>
     *   <li>{@code firstContactRelative}: first contact time; {@code <0} or non-finite means unknown
     *       (see {@link #UNKNOWN_FIRST_CONTACT}). {@code 0} is a valid contact time.</li>
     *   <li>{@code battleEndRelative}: battle end time, must be finite and {@code >=0}.</li>
     * </ul>
     * Every returned phase satisfies: start/end are finite, {@code >=0}, {@code start<=end},
     * {@code end<=battleEndRelative}. Returns empty list when no credible timeline exists.
     */
    public static List<BattlePhaseSummary> buildRelativePhases(
            final float firstContactRelative,
            final float battleEndRelative
    ) {
        return buildPhases(firstContactRelative, battleEndRelative);
    }

    /**
     * Build battle-relative phases with survival counts.
     * <p>与 {@link #buildRelativePhases} 完全相同的阶段边界，附加每阶段结束时的
     * 双方存活人数（{@code friendlyAlive/enemyAlive}）与密集击杀段标记（{@code denseKills}）。
     * 人数来自 {@link SurvivalTimeline}——死亡时刻优先 battle_results 的 deathTimeMillis，
     * 缺失时回退事件流估算（{@link PlayerResultFormat#deathSec}），来源由
     * {@link #deathSourceLabel} 标注；某侧人数不可算（无名册/视角未知/存在未知死亡时刻）
     * 时为 null，调用方渲染为「未知」，绝不猜测。</p>
     */
    public static List<BattlePhaseSummary> buildRelativePhasesWithSurvival(
            final float firstContactRelative,
            final float battleEndRelative,
            final SurvivalTimeline survival
    ) {
        final List<BattlePhaseSummary> phases = buildPhases(firstContactRelative, battleEndRelative);
        if (phases.isEmpty() || survival == null) {
            return phases;
        }
        final boolean friendlyKnown = survival.friendlyRosterSize() > 0
                && survival.friendlyUnknownDeaths() == 0;
        final boolean enemyKnown = survival.enemyRosterSize() > 0
                && survival.enemyUnknownDeaths() == 0;
        final List<Float> friendlySorted = sortedCopy(survival.friendlyDeathTimes());
        final List<Float> enemySorted = sortedCopy(survival.enemyDeathTimes());
        final List<BattlePhaseSummary> result = new ArrayList<>(phases.size());
        for (final BattlePhaseSummary phase : phases) {
            result.add(new BattlePhaseSummary(
                    phase.startTime(),
                    phase.endTime(),
                    phase.type(),
                    phase.confidence(),
                    friendlyKnown ? aliveCount(friendlySorted, survival.friendlyRosterSize(), phase.endTime()) : null,
                    enemyKnown ? aliveCount(enemySorted, survival.enemyRosterSize(), phase.endTime()) : null,
                    isDenseKillWindow(phase, survival)));
        }
        return result;
    }

    /** 阶段边界构建（不含存活人数），行为与 {@link #buildRelativePhases} 保持逐字节一致。 */
    private static List<BattlePhaseSummary> buildPhases(
            final float firstContactRelative,
            final float battleEndRelative
    ) {
        final List<BattlePhaseSummary> phases = new ArrayList<>();
        if (!Float.isFinite(battleEndRelative) || battleEndRelative <= 0f) return phases;

        final boolean validContact = firstContactRelative >= 0
                && Float.isFinite(firstContactRelative)
                && firstContactRelative < battleEndRelative;

        // OPENING: [0, min(validContact && contactTime < 45 ? contactTime : 45, battleEnd)]
        final float openingEnd = validContact && firstContactRelative < OPENING_DURATION
                ? Math.min(firstContactRelative, battleEndRelative)
                : Math.min(OPENING_DURATION, battleEndRelative);
        phases.add(new BattlePhaseSummary(0f, openingEnd, BattlePhaseType.OPENING, DecodeConfidence.EXACT));

        // FIRST_CONTACT (if valid contact): [contactTime, min(contactTime + FIRST_CONTACT_DURATION, battleEnd)]
        if (validContact) {
            final float contactEnd = Math.min(firstContactRelative + FIRST_CONTACT_DURATION, battleEndRelative);
            if (contactEnd > firstContactRelative) {
                phases.add(new BattlePhaseSummary(firstContactRelative, contactEnd,
                        BattlePhaseType.FIRST_CONTACT, DecodeConfidence.INFERRED));
            }
        }

        // MID_GAME: starts at the END of the previous phase, only if enough room
        final float prevEnd = phases.get(phases.size() - 1).endTime();
        if (battleEndRelative - prevEnd > MID_GAME_MIN_DURATION) {
            phases.add(new BattlePhaseSummary(prevEnd, battleEndRelative,
                    BattlePhaseType.MID_GAME, DecodeConfidence.INFERRED));
        }

        // ENDGAME: zero-length marker at battleEnd
        phases.add(new BattlePhaseSummary(battleEndRelative, battleEndRelative,
                BattlePhaseType.ENDGAME, DecodeConfidence.EXACT));

        return phases;
    }

    /** 阶段结束时的存活人数 = 总人数 - 已阵亡（死亡时刻 <= endTime 的玩家数）。 */
    private static int aliveCount(
            final List<Float> sortedDeathTimes,
            final int rosterSize,
            final float endTime
    ) {
        int deaths = 0;
        for (final float deathTime : sortedDeathTimes) {
            if (deathTime <= endTime) {
                deaths++;
            } else {
                break;
            }
        }
        return rosterSize - deaths;
    }

    /**
     * 密集击杀启发式：阶段内（含两端边界）双方已知阵亡时刻中，
     * 存在任意 {@link #DENSE_KILL_WINDOW_SEC} 秒窗口内合计阵亡数 >= {@link #MIN_DENSE_KILLS}。
     */
    private static boolean isDenseKillWindow(
            final BattlePhaseSummary phase,
            final SurvivalTimeline survival
    ) {
        final List<Float> times = new ArrayList<>(survival.friendlyDeathTimes());
        times.addAll(survival.enemyDeathTimes());
        if (times.size() < MIN_DENSE_KILLS) {
            return false;
        }
        final List<Float> inPhase = times.stream()
                .filter(t -> t >= phase.startTime() && t <= phase.endTime())
                .sorted()
                .toList();
        for (int i = 0; i < inPhase.size(); i++) {
            final float windowEnd = inPhase.get(i) + DENSE_KILL_WINDOW_SEC;
            int count = 0;
            for (int j = i; j < inPhase.size() && inPhase.get(j) <= windowEnd; j++) {
                count++;
            }
            if (count >= MIN_DENSE_KILLS) {
                return true;
            }
        }
        return false;
    }

    private static List<Float> sortedCopy(final List<Float> times) {
        return times.stream().sorted().toList();
    }

    /**
     * 双方存活时间线（死亡时刻优先 battle_results 的 deathTimeMillis，缺失时回退
     * 事件流估算；来源由 {@link #deathSourceLabel} 标注）。
     * <p>{@code friendlyDeathTimes/enemyDeathTimes} 只包含死亡时刻已知（>0）的阵亡玩家；
     * {@code *UnknownDeaths} 是死亡时刻缺失（deathSec <= 0）的阵亡玩家数 —— 这类玩家无法
     * 归入任何时间窗，整侧存活人数不可算，渲染为「未知」而非猜测。</p>
     */
    public record SurvivalTimeline(
            List<Float> friendlyDeathTimes,
            List<Float> enemyDeathTimes,
            int friendlyRosterSize,
            int enemyRosterSize,
            int friendlyUnknownDeaths,
            int enemyUnknownDeaths
    ) {
        public SurvivalTimeline {
            friendlyDeathTimes = friendlyDeathTimes == null ? List.of() : List.copyOf(friendlyDeathTimes);
            enemyDeathTimes = enemyDeathTimes == null ? List.of() : List.copyOf(enemyDeathTimes);
            if (friendlyRosterSize < 0) throw new IllegalArgumentException("friendlyRosterSize must be >= 0");
            if (enemyRosterSize < 0) throw new IllegalArgumentException("enemyRosterSize must be >= 0");
            if (friendlyUnknownDeaths < 0) throw new IllegalArgumentException("friendlyUnknownDeaths must be >= 0");
            if (enemyUnknownDeaths < 0) throw new IllegalArgumentException("enemyUnknownDeaths must be >= 0");
        }

        /**
         * 从权威结算构建双方时间线。
         * <p>视角队伍（recorder team / perspectiveTeam）外的有效队伍玩家视为敌方；
         * 名册缺失、视角未知或非法时返回空时间线（roster=0 → 存活人数不可算）。</p>
         */
        public static SurvivalTimeline fromBattleResults(
                final Battle battle,
                final Integer perspectiveTeam
        ) {
            if (battle == null || battle.players == null
                    || perspectiveTeam == null || !PlayerSideResolver.isValidRawTeam(perspectiveTeam)) {
                return new SurvivalTimeline(List.of(), List.of(), 0, 0, 0, 0);
            }
            final List<Float> friendlyTimes = new ArrayList<>();
            final List<Float> enemyTimes = new ArrayList<>();
            int friendlyRoster = 0;
            int enemyRoster = 0;
            int friendlyUnknown = 0;
            int enemyUnknown = 0;
            for (final PlayerResult p : battle.players) {
                if (!PlayerSideResolver.isValidRawTeam(p.team)) {
                    continue;
                }
                final boolean friendly = p.team == perspectiveTeam;
                if (friendly) {
                    friendlyRoster++;
                } else {
                    enemyRoster++;
                }
                if (p.survived) {
                    continue;
                }
                final double deathSec = PlayerResultFormat.deathSec(p);
                if (deathSec > 0) {
                    (friendly ? friendlyTimes : enemyTimes).add((float) deathSec);
                } else if (friendly) {
                    friendlyUnknown++;
                } else {
                    enemyUnknown++;
                }
            }
            return new SurvivalTimeline(
                    friendlyTimes, enemyTimes,
                    friendlyRoster, enemyRoster,
                    friendlyUnknown, enemyUnknown);
        }
    }
}
