package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostOptionsDto;
import com.wotb.web.boost.dto.OptionDto;
import com.wotb.web.boost.enums.BoostRegion;
import com.wotb.web.boost.enums.BoostRequestType;
import com.wotb.web.boost.enums.ContactType;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.List;

/** 将后端枚举映射为不含本地化文案的选项 DTO。 */
@Service
public class BoostOptionsMapper {

    public BoostOptionsDto toDto() {
        return new BoostOptionsDto(
                options(BoostRegion.values()),
                options(BoostRequestType.values()),
                options(ContactType.values()),
                "SENSITIVE_INFO_WARNING"
        );
    }

    private static List<OptionDto> options(final Enum<?>[] values) {
        return Arrays.stream(values)
                .map(value -> new OptionDto(value.name(), true))
                .toList();
    }
}
