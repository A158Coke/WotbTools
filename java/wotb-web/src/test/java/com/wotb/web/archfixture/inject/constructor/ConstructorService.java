package com.wotb.web.archfixture.inject.constructor;

/** 架构规则 mutation 测试夹具：构造器注入（规则应允许）。 */
public final class ConstructorService {

    private final String dependency;

    public ConstructorService(final String dependency) {
        this.dependency = dependency;
    }
}
