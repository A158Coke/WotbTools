package com.wotb.web.archfixture.cross.service;

import com.wotb.web.archfixture.other.repository.OtherDomainRepository;

public final class CrossDomainService {

    private final OtherDomainRepository repository;

    public CrossDomainService(final OtherDomainRepository repository) {
        this.repository = repository;
    }
}
