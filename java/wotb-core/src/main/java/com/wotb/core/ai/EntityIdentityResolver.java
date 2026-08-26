package com.wotb.core.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.PlayerSideResolver.Side;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.ObservedMaxHp;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.util.PromptDataQuoter;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 把事件流里的 entityId 解析成人类可读身份：阵营 + 昵称 + 权威坦克名称 + 结构化车种。
 * <p>没有这层解析时，位置时间线只能输出 {@code Entity#7}，AI 拿到了敌人的位置和时间
 * 却不知道那是哪辆车，敌方情报等于作废。</p>
 * <p>解析链路全部走权威数据：{@code entityId → VehicleState.accountId → 权威名册 PlayerResult}，
 * 坦克名称与车种仍只由 {@code tankId} 查表得到，不解析名称文本、不猜测任何属性。</p>
 */
public final class EntityIdentityResolver {

    private EntityIdentityResolver() {
    }

    /**
     * 构建 entityId → 身份标签。仅包含能在权威名册里找到的实体；
     * 无法解析的实体不会出现在结果里，调用方应回退到 {@code E<id>} 这类中性写法。
     */
    public static Map<Integer, String> resolveLabels(
            final ReplayReconstruction recon,
            final Battle battle,
            final long recorderAccountId
    ) {
        final Map<Integer, String> labels = new LinkedHashMap<>();
        if (recon == null || recon.checkpoints() == null || battle == null) {
            return labels;
        }
        final Map<Long, PlayerResult> roster = new LinkedHashMap<>();
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                roster.putIfAbsent(p.accountId, p);
            }
        }
        if (roster.isEmpty()) {
            return labels;
        }
        for (final BattleStateCheckpoint cp : recon.checkpoints()) {
            if (cp == null || cp.stateSnapshot() == null) continue;
            for (final Map.Entry<Integer, VehicleState> entry
                    : cp.stateSnapshot().vehiclesByEntityId().entrySet()) {
                final int entityId = entry.getKey();
                if (labels.containsKey(entityId)) continue;
                final Long accountId = entry.getValue() != null ? entry.getValue().accountId() : null;
                if (accountId == null) continue;
                final PlayerResult player = roster.get(accountId);
                if (player == null) continue;
                labels.put(entityId, label(battle, player, recorderAccountId));
            }
        }
        return labels;
    }

    /**
     * 单个实体的身份标签，例如
     * {@code 敌方 "EnemyAce" 坦克: "SPHT" 车种: 重坦 等级: 10 国家: 美国}。
     */
    public static String label(final Battle battle, final PlayerResult player, final long recorderAccountId) {
        if (player == null) {
            return "未知实体";
        }
        if (player.accountId == recorderAccountId) {
            // 随机战个人复盘直接面向玩家本人，统一用第二人称
            return "你";
        }
        final Side side = PlayerSideResolver.resolve(battle, player);
        final StringBuilder sb = new StringBuilder(64);
        sb.append(sideLabel(side)).append(' ')
                .append(PromptDataQuoter.quote(player.nickname, "\"\""))
                .append(" 坦克: ").append(PromptDataQuoter.quote(
                        ReplayDisplayNames.tankName(player.tankId, player.tankName), "\"未知坦克\""))
                .append(" 车种: ").append(ReplayDisplayNames.tankClass(player.tankId));
        appendStructuredTankFacts(sb, player.tankId, player);
        return sb.toString();
    }

    /**
     * 追加 tankopedia 的结构化车辆事实（等级 / 国家 / 炮伤 / 血量 / 知识）。
     * 只输出车辆库真实提供的字段，缺失即不输出，绝不由名称推断。
     */
    public static void appendStructuredTankFacts(final StringBuilder sb, final long tankId) {
        appendStructuredTankFacts(sb, tankId, null);
    }

    /**
     * 追加坦克的结构化车辆事实（等级 / 国家 / 炮伤 / 血量 / 知识）。
     * 血量按 provenance 口径（见 {@link ObservedMaxHp#fullMaxHp}）：OBSERVED_EXACT →
     * 已证明进场满血（含装备/物资加成）；否则 tankopedia base。整场观测最大 current HP
     * （observedMaxHp）不得冒充满血输出。
     */
    public static void appendStructuredTankFacts(final StringBuilder sb, final long tankId,
                                                 final PlayerResult player) {
        final String tier = ReplayDisplayNames.tankTier(tankId);
        if (!tier.isEmpty()) {
            sb.append(" 等级: ").append(tier);
        }
        final String nation = ReplayDisplayNames.tankNation(tankId);
        if (!nation.isEmpty()) {
            sb.append(" 国家: ").append(nation);
        }
        final String alpha = ReplayDisplayNames.tankAlphaDamage(tankId);
        if (!alpha.isEmpty()) {
            sb.append(" 炮伤: ").append(alpha);
        }
        final Integer maxHp = player == null
                ? ReplayDisplayNames.tankMaxHpValue(tankId) : ObservedMaxHp.fullMaxHp(player);
        if (maxHp != null && maxHp > 0) {
            sb.append(" 血量: ").append(maxHp);
        }
        final String knowledge = ReplayDisplayNames.tankExtraInfo(tankId);
        if (!knowledge.isEmpty()) {
            sb.append(" 知识: ").append(PromptDataQuoter.quote(knowledge, "\"\""));
        }
    }

    private static String sideLabel(final Side side) {
        return switch (side) {
            case FRIENDLY -> "队友";
            case ENEMY -> "敌方";
            case UNKNOWN -> "未知阵营";
        };
    }

    /** 供 prompt 使用的实体对照表，例如 {@code E7=敌方 "EnemyAce" 坦克: "SPHT" 车种: 重坦}。 */
    public static String legend(final Map<Integer, String> labels) {
        if (labels.isEmpty()) {
            return "";
        }
        final List<String> parts = labels.entrySet().stream()
                .map(e -> "E" + e.getKey() + "=" + e.getValue())
                .toList();
        return "# 实体对照: " + String.join("; ", parts) + "\n";
    }
}
