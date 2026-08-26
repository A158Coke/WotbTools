package com.wotb.web.archfixture.inject.value;

import org.springframework.beans.factory.annotation.Value;

/** 架构规则 mutation 测试夹具：@Value 字段注入（收紧后必须被拦截）。 */
public class ValueFieldService {

    @Value("${wotb.arch-fixture.value}")
    private String injected;
}
