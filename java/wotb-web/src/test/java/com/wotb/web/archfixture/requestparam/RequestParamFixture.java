package com.wotb.web.archfixture.requestparam;

import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.Map;

/**
 * {@code RequestParamExplicitNameTest} 的 mutation fixture：
 * unnamed 形态必须被拒绝（红灯），显式 name/value 与 Map/MultiValueMap
 * 聚合绑定必须被接受（绿灯）。
 */
final class RequestParamFixture {

    void unnamed(@RequestParam String unnamedFixtureParameter) {
        // 红灯：无 name/value，且参数不是 Map 类型
    }

    void explicitName(@RequestParam(name = "q") String q) {
        // 绿灯：显式 name
    }

    void explicitValue(@RequestParam(value = "q") String q) {
        // 绿灯：显式 value（同样是显式绑定名）
    }

    void multiValueMap(@RequestParam MultiValueMap<String, String> params) {
        // 绿灯：unnamed 的 MultiValueMap 聚合绑定是 Spring 合法形态（例外）
    }

    void plainMap(@RequestParam Map<String, String> params) {
        // 绿灯：unnamed 的 Map 聚合绑定是 Spring 合法形态（例外）
    }
}
