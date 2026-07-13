package com.wotb.web.leaderboard.service;

import com.wotb.core.model.Battle;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/** 公开排行榜上传的解析与入库编排。 */
@Service
public class LeaderboardUploadService {

    private static final int RANDOM_BATTLE_TYPE = 1;

    private final LeaderboardService leaderboardService;
    private final ReplayCapacityLimiter capacityLimiter;
    private final Tankopedia tankopedia = Tankopedia.load();

    public LeaderboardUploadService(
            final LeaderboardService leaderboardService,
            final ReplayCapacityLimiter capacityLimiter) {
        this.leaderboardService = leaderboardService;
        this.capacityLimiter = capacityLimiter;
    }

    public Map<String, Object> upload(final MultipartFile file) throws Exception {
        return capacityLimiter.execute(() -> {
            final Battle battle = ReplayParser.parse(file.getBytes());
            final boolean saved = leaderboardService.recordRecorder(battle, tankopedia);
            final String arenaId = battle.arenaId == null ? "" : battle.arenaId;
            if (!saved) {
                return Map.of(
                        "status", "skipped",
                        "arenaId", arenaId,
                        "reasonCode", reasonCode(battle)
                );
            }
            return Map.of("status", "ok", "arenaId", arenaId);
        });
    }

    private static String reasonCode(final Battle battle) {
        return battle.arenaBonusType == null || battle.arenaBonusType != RANDOM_BATTLE_TYPE
                ? "NON_RANDOM_BATTLE"
                : "DUPLICATE_OR_UNKNOWN_RECORDER";
    }
}
