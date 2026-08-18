package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 死亡时刻校准：用重建事件流的权威 HP 死亡证据校准结算缺失的死亡时刻。
 *
 * <p>死亡时刻优先级链（{@code PlayerResultFormat#deathSec} 消费）：
 * <ol>
 *   <li><b>结算 {@code deathTimeMillis}</b>（游戏权威；&gt;0 时直接采用，本类不触碰）；</li>
 *   <li><b>事件流 EXACT {@code alive=false}</b>（type-7 propId=3 HP=0）：同账号全部实体的
 *       最后一条 = 最终阵亡（覆盖争霸/复生多次死亡；单次死亡时首尾相同）；</li>
 *   <li><b>legacy 启发式估算</b>（damage-threshold / EntityLeave / Position 停止）：仅在没有
 *       更可靠死亡证据时兜底，且必须通过一致性检查——若 legacy 死亡时刻早于该账号最后一条
 *       EXACT {@code alive=true}（HP&gt;0），该 legacy 时刻已被真实回放证据证伪，
 *       置为 UNKNOWN（{@code survivalTimeSec = 0}，项目既有 unknown contract：
 *       playback {@code deathSec=null}、AI 显示「未知」），绝不保留被证伪的值、也不伪造新时刻。</li>
 * </ol>
 *
 * <p><b>身份解析只复用 {@link TeamEntityMapper} 产出的权威 {@link TeamEntityMapping}</b>：
 * 仅当 {@code mapping.identity(entityId)} 可用（{@link TeamEntityIdentity#usable()}，
 * 即 EXACT/INFERRED 且账号或昵称可归属）时，该实体的 HP 证据才被接受；
 * 冲突实体（同一 entity 归属多个账号，被 mapper 整体排除 → {@code identity == null}）
 * 与低置信度映射（PARTIAL/UNKNOWN → 不可用）一律不得产出死亡时刻——
 * 死亡校准的身份可信度不低于 playback 其它功能（位置/方向/血量均走同一 mapping）。</p>
 *
 * <p>取「最后一条」alive=false = 最终阵亡：争霸/复生等多次死亡场景下早期死亡≠出局，
 * 死亡时刻应指玩家不再参战的那一刻。位置/方向/伤害事件不参与推断（阵亡后服务器仍广播
 * 死车位置，协议已证明），杜绝「后续任意事件→复活」的粗暴逻辑。</p>
 *
 * <p><b>副作用声明</b>：本类<b>不是纯函数</b>——会原地修改
 * {@code battle.players} 中非存活且 {@code deathTimeMillis == 0} 玩家的
 * {@code survivalTimeSec}（覆盖为证据时刻 / 0=UNKNOWN）。无 battle/events/mapping 或
 * 无可用证据时不做改动（幂等）。调用方（{@link DefaultReplayProcessingFacade}）在
 * 重建成功后、任意 deathSec 消费方之前调用，保证 playback 死亡 ✕ / AI 复盘 / 阶段统计
 * 使用同一套校准后的死亡时刻。</p>
 */
public final class DeathTimeReconciler {

    private DeathTimeReconciler() {
    }

    /**
     * 校准 {@code battle.players} 中非存活且结算无死亡时刻玩家的 {@code survivalTimeSec}。
     *
     * @param battle                已解析战绩（players 会被原地校准）
     * @param events                重建事件流（可能为 null）
     * @param battleStartRawClockSec 战斗开始原始时钟（可能为 null；null 时按 raw 时钟视为 battle-relative）
     * @param mapping               权威实体映射（{@link TeamEntityMapper#resolve} 产出；
     *                              身份不可用的实体证据被拒绝）
     */
    public static void reconcile(
            final Battle battle,
            final List<ReplayEvent> events,
            final Float battleStartRawClockSec,
            final TeamEntityMapping mapping) {
        if (battle == null || battle.players == null || battle.players.isEmpty()
                || events == null || events.isEmpty() || mapping == null) {
            return;
        }

        // 每账号最后一条 EXACT alive=false（HP=0）与 EXACT alive=true（HP>0）的 battle-relative 时刻
        final Map<Long, Double> lastDeathByAccount = new HashMap<>();
        final Map<Long, Double> lastAliveByAccount = new HashMap<>();
        for (final ReplayEvent event : events) {
            if (!(event instanceof HealthChangedEvent h)
                    || h.alive() == null
                    || h.confidence() != DecodeConfidence.EXACT) {
                continue;
            }
            // 身份只信权威 mapping：冲突（identity==null）或不可用（PARTIAL/UNKNOWN）一律拒绝
            final TeamEntityIdentity identity = mapping.identity(h.entityId());
            if (identity == null || !identity.usable()) {
                continue;
            }
            final PlayerResult player = playerOf(battle, identity);
            if (player == null) {
                continue;
            }
            final double t = relativeSec(h, battleStartRawClockSec);
            if (!Double.isFinite(t) || t <= 0) {
                continue;
            }
            if (h.alive()) {
                lastAliveByAccount.merge(player.accountId, t, Math::max);
            } else {
                lastDeathByAccount.merge(player.accountId, t, Math::max);
            }
        }
        if (lastDeathByAccount.isEmpty() && lastAliveByAccount.isEmpty()) {
            return;
        }

        final double duration = battle.durationS != null && battle.durationS > 0
                ? battle.durationS : Double.POSITIVE_INFINITY;
        for (final PlayerResult player : battle.players) {
            // 存活玩家（survivalTimeSec=战斗时长）与结算已提供死亡时刻的玩家不校准
            if (player.survived || player.deathTimeMillis > 0) {
                continue;
            }
            // 规则 2：EXACT alive=false = 最终死亡时刻
            final Double deathEvidence = lastDeathByAccount.get(player.accountId);
            if (deathEvidence != null) {
                player.survivalTimeSec = Math.min(deathEvidence, duration);
                continue;
            }
            // 规则 3 一致性检查：legacy 死亡时刻不得早于最后一条 EXACT alive=true（被证伪 → UNKNOWN）
            final Double lastAlive = lastAliveByAccount.get(player.accountId);
            if (lastAlive != null && player.survivalTimeSec < lastAlive) {
                player.survivalTimeSec = 0;
            }
            // 其余情况（无证据 / legacy 未被 alive 证据否决）保留 legacy
        }
    }

    /** 从权威身份解析到结算玩家：优先账号，其次唯一昵称（nickname fallback 的解析结果）。 */
    private static PlayerResult playerOf(final Battle battle, final TeamEntityIdentity identity) {
        if (identity.accountId() > 0) {
            for (final PlayerResult p : battle.players) {
                if (p.accountId == identity.accountId()) {
                    return p;
                }
            }
            return null;
        }
        if (StringUtils.hasText(identity.nickname())) {
            for (final PlayerResult p : battle.players) {
                if (identity.nickname().equals(p.nickname)) {
                    return p;
                }
            }
        }
        return null;
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
