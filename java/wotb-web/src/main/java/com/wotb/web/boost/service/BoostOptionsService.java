package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostOptionsDto;
import com.wotb.web.boost.dto.OptionDto;
import com.wotb.web.boost.enums.BoostRequestType;
import com.wotb.web.boost.enums.BoostRegion;
import com.wotb.web.boost.enums.ContactType;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.List;

/** 前端下拉选项服务。 */
@Service
public class BoostOptionsService {

    public BoostOptionsDto options() {
        return new BoostOptionsDto(
                regions(),
                requestTypes(),
                contactTypes(),
                "请勿填写账号密码、验证码或其他敏感信息。WotBTools 不会要求你提供游戏账号密码。"
        );
    }

    private static List<OptionDto> regions() {
        return Arrays.stream(BoostRegion.values())
                .map(r -> new OptionDto(r.name(), r.label(), true))
                .toList();
    }

    private static List<OptionDto> requestTypes() {
        return Arrays.stream(BoostRequestType.values())
                .map(t -> new OptionDto(t.name(), t.label(), true))
                .toList();
    }

    private static List<OptionDto> contactTypes() {
        return Arrays.stream(ContactType.values())
                .map(c -> new OptionDto(c.name(), c.label(), true))
                .toList();
    }
}
