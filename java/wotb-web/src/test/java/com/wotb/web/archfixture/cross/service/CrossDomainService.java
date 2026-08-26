package com.wotb.web.archfixture.cross.service;

import com.wotb.web.archfixture.other.repository.OtherDomainRepository;

/** 架构规则 mutation 测试夹具：跨域 repository 依赖（规则必须拦截）。 */
public final class CrossDomainService {

    private final OtherDomainRepository repository;

    public CrossDomainService(final OtherDomainRepository repository) {
        this.repository = repository;
    }
}
