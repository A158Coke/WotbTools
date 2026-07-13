package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostRequestDto;
import com.wotb.web.boost.entity.BoostRequest;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/** 玩家视角需求 DTO 映射，不暴露管理员备注或完整联系方式。 */
@Service
public class BoostRequestMapper {

    public BoostRequestDto toDto(final BoostRequest request, final boolean assigned) {
        return new BoostRequestDto(
                request.getId(),
                request.getPlayerAccountId(),
                request.getPlayerNickname(),
                request.getRegion(),
                request.getRequestType(),
                request.getTargetDescription(),
                request.getBudgetRange(),
                request.getContactType(),
                maskContact(request.getContactValue()),
                request.getAvailableTime(),
                request.getRemark(),
                request.getStatus(),
                assigned,
                request.getCreatedAt(),
                request.getUpdatedAt()
        );
    }

    static String maskContact(final String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        final int length = value.length();
        if (length <= 3) {
            return "***";
        }
        if (length <= 7) {
            return value.charAt(0) + "***" + value.charAt(length - 1);
        }
        return value.substring(0, 3) + "****" + value.substring(length - 3);
    }
}
