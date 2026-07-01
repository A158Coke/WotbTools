package com.wotb.web.leaderboard.service;

import com.wotb.web.util.Mapper;
import com.wotb.web.leaderboard.dto.LeaderboardRecordDto;
import com.wotb.web.leaderboard.entity.LeaderboardRecord;
import org.springframework.stereotype.Service;

@Service
public class LeaderboardRecordMapper implements Mapper<LeaderboardRecord, LeaderboardRecordDto> {

    @Override
    public LeaderboardRecordDto toDto(final LeaderboardRecord r) {
        return new LeaderboardRecordDto(r.getId(), r.getArenaId(), r.getTankId(), r.getTankName(),
                r.getAccountId(), r.getNickname(), r.getDamageDealt(), r.getMapName(),
                r.getVersion(), r.getBattleTime(), r.getCreatedAt());
    }
}
