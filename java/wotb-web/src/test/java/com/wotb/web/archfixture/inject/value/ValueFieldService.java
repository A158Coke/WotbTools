package com.wotb.web.archfixture.inject.value;

import org.springframework.beans.factory.annotation.Value;

public class ValueFieldService {

    @Value("${wotb.arch-fixture.value}")
    private String injected;
}
