package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostOptionsDto;
import org.springframework.stereotype.Service;

/** 前端下拉选项服务。 */
@Service
public class BoostOptionsService {

    private final BoostOptionsMapper mapper;

    public BoostOptionsService(final BoostOptionsMapper mapper) {
        this.mapper = mapper;
    }

    public BoostOptionsDto options() {
        return mapper.toDto();
    }
}
