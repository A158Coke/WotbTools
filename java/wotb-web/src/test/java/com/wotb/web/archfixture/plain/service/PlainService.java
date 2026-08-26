package com.wotb.web.archfixture.plain.service;

import com.wotb.web.archfixture.other.dto.OtherDomainDto;

/** 架构规则 mutation 测试夹具：跨域非 repository 依赖（本规则不应误报）。 */
public final class PlainService {

    private final OtherDomainDto dto;

    public PlainService(final OtherDomainDto dto) {
        this.dto = dto;
    }
}
