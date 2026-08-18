package com.wotb.web.hof.service;

import com.wotb.web.util.Mapper;
import com.wotb.web.hof.dto.HofAdminAuditDto;
import com.wotb.web.hof.entity.HallOfFameAdminLog;
import org.springframework.stereotype.Service;

@Service
public class HallOfFameAdminAuditMapper implements Mapper<HallOfFameAdminLog, HofAdminAuditDto> {

    @Override
    public HofAdminAuditDto toDto(final HallOfFameAdminLog l) {
        return new HofAdminAuditDto(l.getId(), l.getAction(), l.getRecordId(), l.getArenaId(),
                l.getAccountId(), l.getNickname(), l.getTankId(), l.getTankName(), l.getDamageDealt(),
                l.getBattleType(), l.getArenaBonusType(), l.getReplayHash(),
                l.getAdminKeycloakUserId(), l.getAdminUsername(), l.getCreatedAt());
    }
}
