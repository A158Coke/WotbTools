package com.wotb.web.hof.service;

import com.wotb.web.hof.dto.HallOfFamePageDto;
import com.wotb.web.hof.dto.HallOfFameRecordDto;
import com.wotb.web.hof.dto.HofAdminPageDto;
import com.wotb.web.hof.dto.HofAdminRecordDto;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.util.Mapper;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class HallOfFameRecordMapper implements Mapper<HallOfFameRecord, HallOfFameRecordDto> {

    @Override
    public HallOfFameRecordDto toDto(final HallOfFameRecord r) {
        return toPublicDto(r, null);
    }

    public HallOfFameRecordDto toPublicDto(final HallOfFameRecord r, final Integer rank) {
        return new HallOfFameRecordDto(r.getId(), rank, r.getTankId(), r.getTankName(),
                r.getNickname(), r.getDamageDealt(), r.getBattleType(), r.getMapName(),
                r.getVersion(), r.getBattleTime(), r.getCreatedAt(),
                r.getReplayHash() != null);
    }

    public HofAdminRecordDto toAdminDto(final HallOfFameRecord r) {
        return new HofAdminRecordDto(r.getId(), r.getAccountId(), r.getNickname(),
                r.getTankId(), r.getTankName(), r.getBattleType(),
                r.getDamageDealt(), r.getMapName(), r.getVersion(), r.getBattleTime(),
                r.getCreatedAt(), r.getReplayHash(), r.getReplayFileName(), r.getReplaySize(),
                r.getReplayUploadedBy(), r.getReplayHash() != null);
    }

    public HallOfFamePageDto toPageDtoWithRank(final Page<HallOfFameRecord> page,
                                               final int pageNumber, final int pageSize) {
        final long offset = (long) (pageNumber - 1) * pageSize;
        final List<HallOfFameRecordDto> items = new ArrayList<>();
        int i = 0;
        for (final HallOfFameRecord r : page.getContent()) {
            items.add(toPublicDto(r, (int) (offset + i + 1)));
            i++;
        }
        return new HallOfFamePageDto(items, pageNumber, pageSize,
                page.getTotalElements(), page.getTotalPages());
    }

    public HofAdminPageDto toAdminPageDto(final Page<HallOfFameRecord> page,
                                          final int pageNumber, final int pageSize) {
        return new HofAdminPageDto(
                page.getContent().stream().map(this::toAdminDto).toList(),
                pageNumber, pageSize, page.getTotalElements(), page.getTotalPages());
    }
}
