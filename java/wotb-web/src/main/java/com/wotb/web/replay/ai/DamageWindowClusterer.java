package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 把受击者视角的逐次伤害事件按时间间隙聚类成「掉血窗口」，供 Player/Team 证据复用。
 *
 * <p>真实 {@link com.wotb.core.replay.decoder.EntityMethodDecoder} 生成的 {@link DamageEvent} 中
 * {@code attackerAccountId/victimAccountId} 恒为 null，必须沿
 * {@link com.wotb.core.replay.event.ParticipantMappingEvent} 建立 entityId → accountId 映射
 * （复用 {@link com.wotb.core.processing.TeamEntityMapper} 的确定性解析）后，
 * 按 {@code attackerEid/victimEid} 解析身份。
 * 不假设 decoder 在解析 DamageEvent 时已拿到完整参与者映射；同一事件流只解析一次。</p>
 *
 * <p>同一窗口内相邻伤害事件的时间间隔 ≤ {@link #MAX_GAP_SEC}；超过则新开窗口。
 * {@code uniqueAttackerCount} 只统计已解析到账号的不同攻击者：=1 时只能描述为
 * 「短时间集中掉血/高压掉血窗口」，≥2 才可作为「多车集火」证据；
 * {@code attackersUnresolved=true} 时攻击者数不完整，不得断言集火。</p>
 */
final class DamageWindowClusterer {

    /** 同一窗口内相邻伤害事件的最大时间间隔（秒）；超过则新开窗口。 */
    static final double MAX_GAP_SEC = 10.0;

    /**
     * 可断言「短时多车集火」的窗口总跨度上限（秒）。仅当窗口总跨度 ≤ 该阈值、
     * 不同攻击者数 ≥2 且无未解析攻击者时，{@link DamageWindow#focusFireCandidate()} 才为 true；
     * 链式聚类（相邻间隔 ≤10s）形成的更大跨度窗口不得被当作短时集火。
     */
    static final float SHORT_FOCUS_WINDOW_SEC = 15f;

    /** 短窗高额伤害窗口的跨度上限（秒）：窗口跨度 ≤ 该阈值且累计伤害 ≥ {@link #CRITICAL_HP_PCT}% 进场满血量即标出。 */
    static final float CRITICAL_WINDOW_SPAN_SEC = 10f;

    /** 短窗高额伤害窗口的伤害阈值：窗口累计伤害 ≥ 该比例的**进场**满血量（优先回放实测含装备/物资加成，无实测回退 tankopedia 基础值）。 */
    static final double CRITICAL_HP_PCT = 75.0;

    /**
     * 一个掉血窗口（battle-relative 秒）。
     *
     * @param uniqueAttackerCount 窗口内解析出的不同攻击者账号数
     * @param attackersUnresolved 窗口内是否存在攻击者无法解析（true 时不得断言集火）
     * @param focusFireCandidate  窗口总跨度 ≤ {@link #SHORT_FOCUS_WINDOW_SEC}、攻击者 ≥2 且无未解析
     * @param damageVsEntryMaxHpPct 窗口累计伤害占**进场**满血量百分比（优先回放实测含装备/物资加成，
     *                              无实测回退 tankopedia 基础值；只是计算基准，不是实际掉血比例；未知为 null）
     * @param criticalWindow      窗口跨度 ≤ {@link #CRITICAL_WINDOW_SPAN_SEC} 且伤害 ≥ {@link #CRITICAL_HP_PCT}% 进场满血量
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
            boolean criticalWindow) {

        /** 窗口总跨度（秒）。 */
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
        final List<DamageEvent> received = new ArrayList<>();
        for (final ReplayEvent event : recon.events()) {
            if (!(event instanceof DamageEvent damage)) {
                continue;
            }
            if (damage.damage() <= 0) {
                continue;
            }
            if (DamageEventIdentityResolver.victimAccount(damage, mapping) != accountId) {
                continue;
            }
            if (battleStart != null && damage.timestamp() != null
                    && damage.timestamp().rawClockSec() < battleStart) {
                continue; // 准备阶段不计（与其它证据同口径）
            }
            received.add(damage);
        }
        if (received.isEmpty()) {
            return List.of();
        }
        received.sort(Comparator.comparingDouble(
                d -> d.timestamp() == null ? 0.0 : d.timestamp().rawClockSec()));

        final int victimEntryMaxHp = victimEntryMaxHp(battle, accountId);
        final List<DamageWindow> windows = new ArrayList<>();
        float windowStart = -1f;
        float windowEnd = -1f;
        int total = 0;
        int hits = 0;
        final Set<Long> attackers = new LinkedHashSet<>();
        boolean attackersUnresolved = false;
        for (final DamageEvent damage : received) {
            final float relative = relativeSec(damage, battleStart);
            if (windowStart < 0f || relative - windowEnd > MAX_GAP_SEC) {
                if (windowStart >= 0f) {
                    windows.add(window(victimEntryMaxHp,
                            windowStart, windowEnd, total, hits,
                            attackers.size(), attackersUnresolved));
                }
                windowStart = relative;
                total = 0;
                hits = 0;
                attackers.clear();
                attackersUnresolved = false;
            }
            windowEnd = relative;
            total += damage.damage();
            hits++;
            final long attacker = DamageEventIdentityResolver.attackerAccount(damage, mapping);
            if (attacker > 0) {
                attackers.add(attacker);
            } else {
                attackersUnresolved = true;
            }
        }
        windows.add(window(victimEntryMaxHp,
                windowStart, windowEnd, total, hits,
                attackers.size(), attackersUnresolved));
        return windows;
    }

    private static DamageWindow window(final int entryMaxHp,
                                       final float startSec, final float endSec,
                                       final int totalDamage, final int hitCount,
                                       final int uniqueAttackers, final boolean attackersUnresolved) {
        final float span = endSec - startSec;
        // 只是「伤害 / 进场满血量」的计算基准，不是实际掉血比例：
        // 无法证明窗口起始血量、窗口内阵亡与装备加成后的实际最大血量
        final Double pct = entryMaxHp > 0 ? 100.0 * totalDamage / entryMaxHp : null;
        return new DamageWindow(
                startSec, endSec, totalDamage, hitCount,
                uniqueAttackers, attackersUnresolved,
                uniqueAttackers >= 2 && !attackersUnresolved && span <= SHORT_FOCUS_WINDOW_SEC,
                pct,
                pct != null && span <= CRITICAL_WINDOW_SPAN_SEC && pct >= CRITICAL_HP_PCT);
    }

    /** 受击者进场满血量：优先回放实测最大血量（observedMaxHp，含装备/物资加成），无实测回退 tankopedia 基础值；未知返回 0（不参与判定）。 */
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

    /** 满血量基准：observedMaxHp（回放实测，含装备/物资加成）>0 时优先；否则 tankopedia 基础值；均无 → null。 */
    private static Integer hpBaseline(final PlayerResult p) {
        if (p.observedMaxHp != null && p.observedMaxHp > 0) {
            return p.observedMaxHp;
        }
        return ReplayDisplayNames.tankMaxHpValue(p.tankId);
    }

    private static float relativeSec(final DamageEvent damage, final Float battleStart) {
        final float raw = damage.timestamp() == null ? 0f : damage.timestamp().rawClockSec();
        return battleStart != null ? raw - battleStart : raw;
    }
}
