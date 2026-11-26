package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

final class DamageWindowClusterer {

    static final double MAX_GAP_SEC = 10.0;

    static final float SHORT_FOCUS_WINDOW_SEC = 15f;

    static final float CRITICAL_WINDOW_SPAN_SEC = 10f;

    static final double CRITICAL_HP_PCT = 75.0;

    /**
     * 一个掉血窗口（battle-relative 秒）。
     *
     * @param uniqueAttackerCount 窗口内解析出的不同攻击者账号数
     * @param attackersUnresolved 窗口内是否存在攻击者无法解析（true 时不得断言集火）
     * @param focusFireCandidate  窗口总跨度 ≤ {@link #SHORT_FOCUS_WINDOW_SEC}、攻击者 ≥2 且无未解析
     * @param damageVsEntryMaxHpPct 窗口累计伤害占满血量基准百分比（OBSERVED_EXACT=已证明进场满血，
     *                              BASE_FALLBACK=tankopedia base baseline；只是计算基准，不是实际掉血比例；未知为 null）
     * @param entryHpProven        满血量基准是否为已证明的进场满血（false = tankopedia base baseline）
     * @param criticalWindow      仅当 entryHpProven 且窗口跨度 ≤ {@link #CRITICAL_WINDOW_SPAN_SEC}
     *                            且伤害 ≥ {@link #CRITICAL_HP_PCT}% 已证明进场满血量（fail closed：
     *                            base baseline 无法排除真实 entry 更高导致实际比例不足，不判定）
     */
    record DamageWindow(
            float startSec,
            float endSec,
            int totalDamage,
            int hitCount,
            int uniqueAttackerCount,
            boolean attackersUnresolved,
            boolean focusFireCandidate,
            Double damageVsEntryMaxHpPct,
            boolean entryHpProven,
            boolean criticalWindow) {

        float spanSec() {
            return endSec - startSec;
        }
    }

    private DamageWindowClusterer() {
    }

    /**
     * 按受击账号聚合掉血窗口（battle-relative 秒，按时间升序）。
     *
     * @param battle    权威结算（用于 roster 参与的实体映射）；可为 null（仅支持直填账号的合成事件）
     * @param recon     重建结果（含事件流）；null / 无事件 → 空列表
     * @param accountId 受击者账号；≤0 → 空列表
     */
    static List<DamageWindow> receivedWindows(
            final Battle battle,
            final ReplayReconstruction recon,
            final long accountId) {
        if (recon == null || recon.events() == null || accountId <= 0) {
            return List.of();
        }
        final TeamEntityMapping mapping = DamageEventIdentityResolver.mapping(battle, recon);
        final Float battleStart = recon.battleStartRawClockSec();
        final double duration = recon.battleDurationSec() > 0
                ? recon.battleDurationSec()
                : (battle != null && battle.durationS != null && battle.durationS > 0
                        ? battle.durationS : 0.0);
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat =
                com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                        recon.events(), mapping,
                        battleStart == null ? 0.0 : battleStart.doubleValue(), duration, battle);
        final List<com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss> losses =
                combat.lossesOf(accountId);
        if (losses.isEmpty()) {
            return List.of();
        }
        final int victimEntryMaxHp = victimEntryMaxHp(battle, accountId);
        final boolean entryHpProven = entryHpProven(battle, accountId);
        final List<DamageWindow> windows = new ArrayList<>();
        float windowStart = -1f;
        float windowEnd = -1f;
        int total = 0;
        int hits = 0;
        final Set<Long> attackers = new LinkedHashSet<>();
        boolean attackersUnresolved = false;
        for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss loss : losses) {
            final float relative = (float) loss.toSec();
            if (windowStart < 0f || relative - windowEnd > MAX_GAP_SEC) {
                if (windowStart >= 0f) {
                    windows.add(window(victimEntryMaxHp,
                            windowStart, windowEnd, total, hits,
                            attackers.size(), attackersUnresolved, entryHpProven));
                }
                windowStart = relative;
                total = 0;
                hits = 0;
                attackers.clear();
                attackersUnresolved = false;
            }
            windowEnd = relative;
            total += loss.hpLoss();
            hits++;
            final Long attacker = loss.attackerAccountId();
            if (loss.attackerReliable() && attacker != null && attacker > 0) {
                attackers.add(attacker);
            } else {
                attackersUnresolved = true;
            }
        }
        windows.add(window(victimEntryMaxHp,
                windowStart, windowEnd, total, hits,
                attackers.size(), attackersUnresolved, entryHpProven));
        return windows;
    }

    private static DamageWindow window(final int baselineHp,
                                       final float startSec, final float endSec,
                                       final int totalDamage, final int hitCount,
                                       final int uniqueAttackers, final boolean attackersUnresolved,
                                       final boolean entryHpProven) {
        final float span = endSec - startSec;
        final Double pct = baselineHp > 0 ? 100.0 * totalDamage / baselineHp : null;
        return new DamageWindow(
                startSec, endSec, totalDamage, hitCount,
                uniqueAttackers, attackersUnresolved,
                uniqueAttackers >= 2 && !attackersUnresolved && span <= SHORT_FOCUS_WINDOW_SEC,
                pct,
                entryHpProven,
                pct != null && entryHpProven
                        && span <= CRITICAL_WINDOW_SPAN_SEC && pct >= CRITICAL_HP_PCT);
    }

    private static int victimEntryMaxHp(final Battle battle, final long accountId) {
        if (battle == null || battle.players == null) {
            return 0;
        }
        return battle.players.stream()
                .filter(p -> p != null && p.accountId == accountId)
                .findFirst()
                .map(DamageWindowClusterer::hpBaseline)
                .filter(java.util.Objects::nonNull)
                .orElse(0);
    }

    private static boolean entryHpProven(final Battle battle, final long accountId) {
        if (battle == null || battle.players == null) {
            return false;
        }
        return battle.players.stream()
                .filter(p -> p != null && p.accountId == accountId)
                .anyMatch(p -> p.entryHpSource == EntryHpSource.OBSERVED_EXACT
                        && p.entryHp != null && p.entryHp > 0);
    }

    private static Integer hpBaseline(final PlayerResult p) {
        if (p.entryHpSource == EntryHpSource.OBSERVED_EXACT
                && p.entryHp != null && p.entryHp > 0) {
            return p.entryHp;
        }
        return ReplayDisplayNames.tankMaxHpValue(p.tankId);
    }

}
