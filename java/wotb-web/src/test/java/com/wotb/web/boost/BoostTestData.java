package com.wotb.web.boost;

import com.wotb.web.boost.entity.BoosterProfile;

/** 打手模块测试数据工厂。 */
final class BoostTestData {

    private BoostTestData() {}

    static BoosterProfile activeBooster(final Long id) {
        final var b = new BoosterProfile();
        b.setId(id);
        b.setKeycloakUserId("kc-user-" + id);
        b.setNickname("TestBooster" + id);
        b.setLevel("ELITE");
        b.setAvailable(true);
        b.setStatus("ACTIVE");
        return b;
    }

    static BoosterProfile inactiveBooster(final Long id) {
        final var b = activeBooster(id);
        b.setStatus("INACTIVE");
        b.setAvailable(false);
        return b;
    }
}
