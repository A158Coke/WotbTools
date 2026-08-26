package com.wotb.web.archfixture.same.service;

import com.wotb.web.archfixture.same.repository.SameDomainRepository;

/** 架构规则 mutation 测试夹具：同域 repository 依赖（规则应允许）。 */
public final class SameDomainService {

    private final SameDomainRepository repository;

    public SameDomainService(final SameDomainRepository repository) {
        this.repository = repository;
    }
}
