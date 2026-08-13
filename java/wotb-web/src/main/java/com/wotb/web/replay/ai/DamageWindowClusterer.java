package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
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
 * <p>真实 {@link EntityMethodDecoder} 生成的 {@link DamageEvent} 中
 * {@code attackerAccountId/victimAccountId} 恒为 null，必须沿
 * {@link ParticipantMappingEvent} 建立 entityId → accountId 映射（复用
 * {@link TeamEntityMapper} 的确定性解析）后，按 {@code attackerEid/victimEid} 解析身份。
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
     * 一个掉血窗口（battle-relative 秒）。
     *
     * @param uniqueAttackerCount 窗口内解析出的不同攻击者账号数
     * @param attackersUnresolved 窗口内是否存在攻击者无法解析（true 时不得断言集火）
     */
    record DamageWindow(
            float startSec,
            float endSec,
            int totalDamage,
            int hitCount,
            int uniqueAttackerCount,
            boolean attackersUnresolved) {
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
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Float battleStart = recon.battleStartRawClockSec();
        final List<DamageEvent> received = new ArrayList<>();
        for (final ReplayEvent event : recon.events()) {
            if (!(event instanceof DamageEvent damage)) {
                continue;
            }
            if (damage.damage() <= 0) {
                continue;
            }
            if (victimAccount(damage, mapping) != accountId) {
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
                    windows.add(new DamageWindow(
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
            final long attacker = attackerAccount(damage, mapping);
            if (attacker > 0) {
                attackers.add(attacker);
            } else {
                attackersUnresolved = true;
            }
        }
        windows.add(new DamageWindow(
                windowStart, windowEnd, total, hits,
                attackers.size(), attackersUnresolved));
        return windows;
    }

    /** 受击者账号：优先直填字段（合成 fixture），否则经 entityId → accountId 映射解析。 */
    private static long victimAccount(final DamageEvent damage, final TeamEntityMapping mapping) {
        if (damage.victimAccountId() != null && damage.victimAccountId() > 0) {
            return damage.victimAccountId();
        }
        return accountOf(damage.victimEid(), mapping);
    }

    /** 攻击者账号：优先直填字段（合成 fixture），否则经 entityId → accountId 映射解析；无法解析返回 0。 */
    private static long attackerAccount(final DamageEvent damage, final TeamEntityMapping mapping) {
        if (damage.attackerAccountId() != null && damage.attackerAccountId() > 0) {
            return damage.attackerAccountId();
        }
        return accountOf(damage.attackerEid(), mapping);
    }

    private static long accountOf(final int entityId, final TeamEntityMapping mapping) {
        if (entityId <= 0) {
            return 0L;
        }
        final TeamEntityIdentity identity = mapping.identity(entityId);
        return identity != null ? identity.accountId() : 0L;
    }

    private static float relativeSec(final DamageEvent damage, final Float battleStart) {
        final float raw = damage.timestamp() == null ? 0f : damage.timestamp().rawClockSec();
        return battleStart != null ? raw - battleStart : raw;
    }
}
