package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 死亡时刻校准：用重建事件流的权威 HP 死亡证据校准结算缺失的死亡时刻。
 *
 * <p>死亡时刻优先级链（{@code PlayerResultFormat#deathSec} 消费）：结算
 * {@code deathTimeMillis}（游戏权威）&gt; 事件流 EXACT {@code alive=false}（HP=0）证据
 * &gt; legacy 启发式估算（damage-threshold / EntityLeave / Position 停止）。本类负责第二档：
 * 对「结算非存活 且 {@code deathTimeMillis == 0}」的玩家，从其全部实体（含 re-entry）的
 * 最后一条 EXACT {@code alive=false} 事件取 battle-relative 时刻，覆盖
 * {@code survivalTimeSec}（clamp 到战斗时长）；无证据则保留 legacy 估算不动。</p>
 *
 * <p>为什么必须这么做：legacy damage-threshold 启发式只看累计伤害是否越过结算承伤阈值，
 * 无视同实体 EXACT HP 观测——承伤累计因 overcount/装备 HP 差会提前越阈，把「残血仍存活」
 * 误判为「已阵亡」（真实样本：IS-4 在 96.9s 被误判死亡，实际 HP=102 alive，128.12s 才阵亡）。</p>
 *
 * <p>取「最后一条」alive=false = 最终阵亡：争霸/复生等多次死亡场景下早期死亡≠出局，
 * 死亡时刻应指玩家不再参战的那一刻；单次死亡时首尾相同。</p>
 *
 * <p>位置/方向/伤害事件不参与推断（阵亡后服务器仍广播死车位置，协议已证明），
 * 杜绝「后续任意事件→复活」的粗暴逻辑。</p>
 */
public final class DeathTimeReconciler {

    private DeathTimeReconciler() {
    }

    /**
     * 校准 {@code battle.players} 中非存活且结算无死亡时刻玩家的 {@code survivalTimeSec}。
     * 幂等、无副作用：battle/events 为空、无 entity→account 映射或无 EXACT 死亡证据时不做任何改动。
     *
     * @param battle                已解析战绩（players 会被原地校准）
     * @param events                重建事件流（可能为 null）
     * @param battleStartRawClockSec 战斗开始原始时钟（可能为 null；null 时按 raw 时钟视为 battle-relative）
     */
    public static void reconcile(
            final Battle battle,
            final List<ReplayEvent> events,
            final Float battleStartRawClockSec) {
        if (battle == null || battle.players == null || battle.players.isEmpty()
                || events == null || events.isEmpty()) {
            return;
        }

        // entity → account 映射（覆盖 re-entry 全部实体）
        final Map<Integer, Long> accountByEntity = new HashMap<>();
        for (final ReplayEvent event : events) {
            if (event instanceof ParticipantMappingEvent pm && pm.accountId() > 0) {
                accountByEntity.put(pm.entityId(), pm.accountId());
            }
        }
        if (accountByEntity.isEmpty()) {
            return;
        }

        // 每账号最后一条 EXACT alive=false（HP=0）事件的 battle-relative 时刻
        final Map<Long, Double> lastDeathByAccount = new HashMap<>();
        for (final ReplayEvent event : events) {
            if (!(event instanceof HealthChangedEvent h)) {
                continue;
            }
            if (h.alive() == null || h.alive() || h.confidence() != DecodeConfidence.EXACT) {
                continue;
            }
            final Long accountId = accountByEntity.get(h.entityId());
            if (accountId == null || accountId <= 0) {
                continue;
            }
            final double t = relativeSec(h, battleStartRawClockSec);
            if (!Double.isFinite(t) || t <= 0) {
                continue;
            }
            lastDeathByAccount.merge(accountId, t, Math::max);
        }
        if (lastDeathByAccount.isEmpty()) {
            return;
        }

        final double duration = battle.durationS != null && battle.durationS > 0
                ? battle.durationS : Double.POSITIVE_INFINITY;
        for (final PlayerResult player : battle.players) {
            // 存活玩家（survivalTimeSec=战斗时长）与结算已提供死亡时刻的玩家不校准
            if (player.survived || player.deathTimeMillis > 0) {
                continue;
            }
            final Double evidence = lastDeathByAccount.get(player.accountId);
            if (evidence == null) {
                continue;
            }
            player.survivalTimeSec = Math.min(evidence, duration);
        }
    }

    /** battle-relative 秒：与 MapOverviewBuilder.relativeSec 同语义（battleClock 优先，其次 raw-battleStart，最后 raw）。 */
    private static double relativeSec(final HealthChangedEvent h, final Float battleStartRawClockSec) {
        if (h.timestamp() == null) {
            return 0;
        }
        final Float battle = h.timestamp().battleClockSec();
        if (battle != null) {
            return battle;
        }
        if (battleStartRawClockSec != null && Float.isFinite(battleStartRawClockSec)) {
            return h.timestamp().rawClockSec() - battleStartRawClockSec;
        }
        return h.timestamp().rawClockSec();
    }
}
