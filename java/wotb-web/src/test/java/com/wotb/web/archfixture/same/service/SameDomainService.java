package com.wotb.web.archfixture.same.service;

import com.wotb.web.archfixture.same.repository.SameDomainRepository;

public final class SameDomainService {

    private final SameDomainRepository repository;

    public SameDomainService(final SameDomainRepository repository) {
        this.repository = repository;
    }
}
