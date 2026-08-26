package com.wotb.web.archfixture.inject.autowired;

import org.springframework.beans.factory.annotation.Autowired;

/** 架构规则 mutation 测试夹具：@Autowired 字段注入（规则必须拦截）。 */
public class AutowiredFieldService {

    @Autowired
    private String injected;
}
