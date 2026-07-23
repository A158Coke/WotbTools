package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 默认队伍特征提取器（第一版：基础实现，后续增强）。
 * 分析 perspectiveTeam 所有己方实体的整体移动和交火。
 */
public class DefaultTeamBattleFeatureExtractor implements TeamBattleFeatureExtractor {

    static final int ENGAGEMENT_GAP_SEC = 10;

    @Override
    public TeamBattleFeatureSet extract(ReplayReconstruction reconstruction, int perspectiveTeam) {
        final List<ReplayEvent> events = reconstruction.events();

        // 收集本队所有 entityId
        final Set<Integer> teamEntities = new HashSet<>();
        // entityId → team 映射（从 ParticipantMappingEvent 获取）
        final Map<Integer, Integer> entityTeamMap = new HashMap<>();
        // entityId → accountId
        final Map<Integer, Long> entityToAccount = new HashMap<>();

        for (final ReplayEvent event : events) {
            if (event instanceof ParticipantMappingEvent pm) {
                entityToAccount.put(pm.entityId(), pm.accountId());
            }
        }
        // 通过 BattleParticipant 或 reconstruction 获取 team
        final var participants = reconstruction.participants();
        for (final var p : participants) {
            entityTeamMap.put((int) p.accountId(), p.team());
            if (p.team() == perspectiveTeam) {
                // 通过 accountId → entityId 反向查找（简化处理）
            }
        }
        // 简化：从事件流中通过 team 信息获取本队 entityId
        // 当前 reconstruction 缺少稳定的 entityId→team 映射，做简化处理

        // 收集本队位置事件（简化：所有 entity 假设都在本队）
        final List<PositionChangedEvent> teamPositions = new ArrayList<>();
        final List<DamageEvent> teamDamageEvents = new ArrayList<>();

        for (final ReplayEvent event : events) {
            if (event instanceof PositionChangedEvent p) {
                teamPositions.add(p);
            } else if (event instanceof DamageEvent d) {
                teamDamageEvents.add(d);
            }
        }

        // 压缩移动段
        final List<MovementSegment> movements = DefaultPlayerBattleFeatureExtractor.compressMovements(teamPositions);

        // 交火段（团队视角简化：汇总时间段内所有团队相关伤害事件）
        final List<EngagementSummary> engagements = buildTeamEngagements(teamDamageEvents);

        // 阶段划分
        float battleEndClock = Float.NaN;
        for (final ReplayEvent e : events) {
            if (e instanceof com.wotb.core.replay.event.BattleEndedEvent b) {
                battleEndClock = DefaultPlayerBattleFeatureExtractor.clockOf(b.timestamp());
                break;
            }
        }
        final List<BattlePhaseSummary> phases = DefaultBattleFeatureExtractor.dividePhases(
                events, battleEndClock, -1f);

        // 关键事件
        final List<KeyBattleEvent> keyEvents = extractKeyEvents(events);
        final int eventCount = teamDamageEvents.size();

        return new TeamBattleFeatureSet(perspectiveTeam, movements, engagements,
                phases, keyEvents,
                List.of("Team perspective is preliminary - entity-team mapping simplified"),
                eventCount > 0);
    }

    private List<KeyBattleEvent> extractKeyEvents(List<ReplayEvent> events) {
        final List<KeyBattleEvent> result = new ArrayList<>();
        boolean firstBlood = false;
        for (final ReplayEvent event : events) {
            if (result.size() >= 30) break;
            switch (event) {
                case DamageEvent d -> {
                    if (!firstBlood) {
                        firstBlood = true;
                        result.add(new KeyBattleEvent(
                                DefaultPlayerBattleFeatureExtractor.clockOf(d.timestamp()),
                                "TEAM_FIRST_BLOOD", "队伍首次伤害 " + d.damage()));
                    }
                }
                case com.wotb.core.replay.event.BattleEndedEvent b ->
                    result.add(new KeyBattleEvent(
                            DefaultPlayerBattleFeatureExtractor.clockOf(b.timestamp()),
                            "BATTLE_END", "战斗结束"));
                default -> {}
            }
        }
        return result;
    }

    private static List<EngagementSummary> buildTeamEngagements(List<DamageEvent> teamDamage) {
        // 当前缺少可靠的 entity→team 映射，无法区分 team dealt vs team received
        // 因此报告 dealt=0, received=0，在 limitation 中说明
        return List.of();
    }
}
