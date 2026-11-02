package com.wotb.ai.archfixture;

import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.Map;

/**
 * {@code RequestParamExplicitNameTest}（wotb-ai 镜像）的 mutation fixture：
 * unnamed / 空 name / 空 value 形态必须被拒绝（红灯），显式 name 与
 * Map/MultiValueMap 聚合绑定必须被接受（绿灯）。
 */
final class RequestParamFixture {

    void unnamed(@RequestParam String unnamedFixtureParameter) {
        // 红灯：无 name/value，且参数不是 Map 类型
    }

    void emptyName(@RequestParam(name = "") String emptyNameParameter) {
        // 红灯：空串 name——Spring 回退到 Java 参数名做隐式绑定
    }

    void emptyValue(@RequestParam(value = "") String emptyValueParameter) {
        // 红灯：value 空串与空 name 等价
    }

    void explicitName(@RequestParam(name = "permit") String permit) {
        // 绿灯：显式 name
    }

    void multiValueMap(@RequestParam MultiValueMap<String, String> params) {
        // 绿灯：unnamed 的 MultiValueMap 聚合绑定是 Spring 合法形态（例外）
    }

    void plainMap(@RequestParam Map<String, String> params) {
        // 绿灯：unnamed 的 Map 聚合绑定是 Spring 合法形态（例外）
    }
}
