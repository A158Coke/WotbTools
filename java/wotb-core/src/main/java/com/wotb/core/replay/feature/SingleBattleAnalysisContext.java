package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * 单场 AI 分析上下文（预留模型，后续实现 AiInputFactory 时使用）。
 *
 * TODO: implement SingleBattleAiInputFactory to construct this from ReplayProcessingResult
 */
public record SingleBattleAnalysisContext(
        ReplayProcessingResult replay,
        BattleSummary battleSummary,
        ReplayReconstruction reconstruction,
        BattleFeatureSet features,
        Coverage coverage
) {

    /** 战后统计摘要（预留）。 */
    public record BattleSummary(
            String mapName,
            int durationSec,
            Integer winnerTeam,
            int playerCount
    ) {
        public static BattleSummary from(Battle battle) {
            return new BattleSummary(
                    battle.mapName,
                    battle.durationS != null ? battle.durationS.intValue() : 0,
                    battle.winnerTeam,
                    battle.nPlayers()
            );
        }
    }

    /** 覆盖率摘要（预留）。 */
    public record Coverage(
            boolean streamComplete,
            int totalPackets,
            double decodedRatio
    ) {
        public static Coverage from(com.wotb.core.replay.reconstruction.ReplayCoverage c) {
            return new Coverage(
                    c.streamComplete(),
                    c.totalPackets(),
                    c.decodedPacketRatio()
            );
        }
    }
}
