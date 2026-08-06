package com.wotbtools.keycloak.wargaming;

import java.net.URI;
import java.util.Locale;

/**
 * Wargaming.net WoT Blitz 区服白名单。
 *
 * <p>三个官方 host（asia/eu/com）均已实测返回统一 {@code application_id} 要求，
 * 证明 WoT Blitz 的 {@code application_id} 按游戏注册、跨区通用；本枚举把区服
 * 显式映射到固定 host，不接受任何调用方传入的 URL（安全要求：白名单固定）。
 * 后续新增区服只需扩展本枚举与 Admin Console 的 region 选项。</p>
 */
enum WargamingRegion {

    ASIA("asia", "api.wotblitz.asia"),
    EU("eu", "api.wotblitz.eu"),
    NA("na", "api.wotblitz.com");

    private final String key;
    private final String host;

    WargamingRegion(final String key, final String host) {
        this.key = key;
        this.host = host;
    }

    /** broker id 使用的小写区服段，如 {@code asia} / {@code eu} / {@code na}。 */
    String key() {
        return key;
    }

    /** 官方 API host，仅来自白名单。 */
    String host() {
        return host;
    }

    URI authBase() {
        return URI.create("https://" + host + "/wot/auth/");
    }

    URI accountBase() {
        return URI.create("https://" + host + "/wotb/account/");
    }

    /**
     * 按配置值（大小写不敏感）解析区服；未知值返回 {@code null}，
     * 由配置层回退到 {@link #ASIA}（向后兼容未配置区服的存量实例）。
     */
    static WargamingRegion fromKey(final String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        final String normalized = value.trim().toUpperCase(Locale.ROOT);
        for (final WargamingRegion region : values()) {
            if (region.name().equals(normalized)) {
                return region;
            }
        }
        return null;
    }
}
