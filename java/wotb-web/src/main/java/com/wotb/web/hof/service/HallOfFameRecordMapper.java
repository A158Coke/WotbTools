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

    /**
     * 公开 DTO；rank 为当前查询上下文位置排名（无排名上下文时传 null）。
     */
    public HallOfFameRecordDto toPublicDto(final HallOfFameRecord r, final Integer rank) {
        return new HallOfFameRecordDto(r.getId(), rank, r.getTankId(), r.getTankName(),
                r.getNickname(), r.getDamageDealt(), r.getBattleType(), r.getMapName(),
                r.getVersion(), r.getBattleTime(), r.getCreatedAt(),
                r.getReplayHash() != null);
    }

    /**
     * 管理后台全量 DTO（admin 内部字段，不对外）。
     */
    public HofAdminRecordDto toAdminDto(final HallOfFameRecord r) {
        return new HofAdminRecordDto(r.getId(), r.getArenaId(), r.getAccountId(), r.getNickname(),
                r.getTankId(), r.getTankName(), r.getBattleType(), r.getArenaBonusType(),
                r.getDamageDealt(), r.getMapName(), r.getVersion(), r.getBattleTime(),
                r.getCreatedAt(), r.getReplayHash(), r.getReplayFileName(), r.getReplaySize(),
                r.getReplayUploadedBy(), r.getReplayHash() != null);
    }

    /**
     * 公开分页 + 位置排名（rank = (page-1)*size + i + 1，基于当前 filter 上下文）。
     */
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