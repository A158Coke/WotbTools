package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.List;

/**
 * 默认队伍特征提取器（第一版：基础实现，后续增强）。
 * 分析 perspectiveTeam 所有己方实体的整体移动和交火。
 */
public class DefaultTeamBattleFeatureExtractor implements TeamBattleFeatureExtractor {

    static final int ENGAGEMENT_GAP_SEC = 10;

    @Override
    public TeamBattleFeatureSet extract(final ReplayReconstruction reconstruction, final int perspectiveTeam) {
        final List<ReplayEvent> events = reconstruction.events();

        // 收集本队所有位置事件（简化：当前 reconstruction 缺少稳定的 entityId→team 映射）
        final List<PositionChangedEvent> teamPositions = new ArrayList<>();
        final List<DamageEvent> teamDamageEvents = new ArrayList<>();

        for (final ReplayEvent event : events) {
            switch (event) {
                case PositionChangedEvent p -> teamPositions.add(p);
                case DamageEvent d -> teamDamageEvents.add(d);
                default -> {}
            }
        }

        // 压缩移动段
        final List<MovementSegment> movements = DefaultPlayerBattleFeatureExtractor.compressMovements(teamPositions);

        // 交火段（团队视角简化：因缺少 entity→team 映射，暂不区分 team dealt/received）
        final List<EngagementSummary> engagements = buildTeamEngagements(teamDamageEvents);

        // 阶段划分
        float battleEndClock = Float.NaN;
        for (final ReplayEvent e : events) {
            if (e instanceof com.wotb.core.replay.event.BattleEndedEvent b) {
                battleEndClock = ReplayTimestamp.safeClockSec(b.timestamp());
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

    private static List<KeyBattleEvent> extractKeyEvents(final List<ReplayEvent> events) {
        final List<KeyBattleEvent> result = new ArrayList<>();
        boolean firstBlood = false;
        for (final ReplayEvent event : events) {
            if (result.size() >= 30) break;
            switch (event) {
                case DamageEvent d -> {
                    if (!firstBlood) {
                        firstBlood = true;
                        result.add(new KeyBattleEvent(
                                ReplayTimestamp.safeClockSec(d.timestamp()),
                                "TEAM_FIRST_BLOOD", "队伍首次伤害 " + d.damage()));
                    }
                }
                case com.wotb.core.replay.event.BattleEndedEvent b ->
                    result.add(new KeyBattleEvent(
                            ReplayTimestamp.safeClockSec(b.timestamp()),
                            "BATTLE_END", "战斗结束"));
                default -> {}
            }
        }
        return result;
    }

    private static List<EngagementSummary> buildTeamEngagements(final List<DamageEvent> teamDamage) {
        // 当前缺少可靠的 entity→team 映射，无法区分 team dealt vs team received
        // 因此报告 dealt=0, received=0，在 limitation 中说明
        return List.of();
    }
}
