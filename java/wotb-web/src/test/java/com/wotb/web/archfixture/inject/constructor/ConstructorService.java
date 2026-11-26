package com.wotb.web.archfixture.inject.constructor;

public final class ConstructorService {

    private final String dependency;

    public ConstructorService(final String dependency) {
        this.dependency = dependency;
    }
}
