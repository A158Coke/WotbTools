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
 *   <li><b>事件流 EXACT 权威 lifecycle 状态为 dead</b>（type-7 propId=3 HP=0）：以
 *       {@code (timeSec, sequence)} 判定「最后一条」alive=false 是否发生在最后一条
 *       alive=true 之后。若 dead 是最后权威状态（含从未复生的单次阵亡），该最后一条
 *       alive=false 即最终阵亡时刻；若 alive 是最后权威状态（死亡 → 复生，且之后没有
 *       新的死亡证据），则早期死亡已被复生证据否决，<b>不得</b>作为最终死亡证据；
 *       同 timestamp 由 sequence 判定先后，不编造 epsilon。</li>
 *   <li><b>legacy 启发式估算</b>（damage-threshold / EntityLeave / Position 停止）：仅在没有
 *       有效 EXACT 死亡证据时兜底，且必须通过一致性检查——若 legacy 死亡时刻不晚于该账号
 *       最后一条 EXACT {@code alive=true}（HP&gt;0），该 legacy 已被真实回放证据证伪，
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
 * <p>死亡 → 复生（dead → alive）时，前面的一次死亡只是早期死亡（争霸/复生场景），
 * 最终死亡时刻 = 最后权威状态为 dead 的那条 alive=false，或（最后权威状态为 alive 时）
 * 由 legacy 检查决定；位置/方向/伤害事件不参与推断（阵亡后服务器仍广播死车位置，
 * 协议已证明），杜绝「后续任意事件→复活」的粗暴逻辑。</p>
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

    /** 一条 EXACT HP 证据（battle-relative 秒 + 事件 sequence）；同秒时 sequence 大者更晚。 */
    private record HealthEvidence(double timeSec, int sequence) {

        /** 是否严格晚于 other（null 视为最早）。 */
        boolean after(final HealthEvidence other) {
            return other == null || timeSec > other.timeSec
                    || (timeSec == other.timeSec && sequence > other.sequence);
        }
    }

    /** 保留较晚的一条证据（同秒时 sequence 大者）。 */
    private static HealthEvidence later(final HealthEvidence a, final HealthEvidence b) {
        return a.after(b) ? a : b;
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

        // 每账号最后一条 EXACT alive=false（HP=0）与 EXACT alive=true（HP>0），按 (timeSec, sequence) 取最后
        final Map<Long, HealthEvidence> lastDeathByAccount = new HashMap<>();
        final Map<Long, HealthEvidence> lastAliveByAccount = new HashMap<>();
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
            final HealthEvidence evidence = new HealthEvidence(t, h.sequence());
            if (h.alive()) {
                lastAliveByAccount.merge(player.accountId, evidence, DeathTimeReconciler::later);
            } else {
                lastDeathByAccount.merge(player.accountId, evidence, DeathTimeReconciler::later);
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
            final HealthEvidence death = lastDeathByAccount.get(player.accountId);
            final HealthEvidence alive = lastAliveByAccount.get(player.accountId);
            if (death != null && (alive == null || death.after(alive))) {
                // 规则 2：dead 是最后权威 lifecycle 状态（含从未复生）→ 最后一条 alive=false 即最终阵亡
                player.survivalTimeSec = Math.min(death.timeSec(), duration);
                continue;
            }
            // 规则 3：alive 是最后权威状态（早期死亡被复生证据否决）或仅有 alive 证据 →
            // legacy 死亡时刻不得早于（<=）最后一条 EXACT alive=true，否则被证伪 → UNKNOWN
            if (alive != null && player.survivalTimeSec <= alive.timeSec()) {
                player.survivalTimeSec = 0;
            }
            // 其余情况（无证据 / legacy 晚于最后 alive evidence）保留 legacy
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
