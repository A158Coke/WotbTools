package com.wotb.web.archfixture.requestparam;

import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.Map;

final class RequestParamFixture {

    void unnamed(@RequestParam String unnamedFixtureParameter) {
    }

    void emptyName(@RequestParam(name = "") String emptyNameParameter) {
    }

    void emptyValue(@RequestParam(value = "") String emptyValueParameter) {
    }

    void explicitName(@RequestParam(name = "q") String q) {
    }

    void explicitValue(@RequestParam(value = "q") String q) {
    }

    void multiValueMap(@RequestParam MultiValueMap<String, String> params) {
    }

    void plainMap(@RequestParam Map<String, String> params) {
    }
}
