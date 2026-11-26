package com.wotb.core.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.ObservedMaxHp;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.PlayerSideResolver.Side;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.util.PromptDataQuoter;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class EntityIdentityResolver {

    private EntityIdentityResolver() {
    }

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

    public static String label(final Battle battle, final PlayerResult player, final long recorderAccountId) {
        if (player == null) {
            return "未知实体";
        }
        if (player.accountId == recorderAccountId) {
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

    public static void appendStructuredTankFacts(final StringBuilder sb, final long tankId) {
        appendStructuredTankFacts(sb, tankId, null);
    }

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
