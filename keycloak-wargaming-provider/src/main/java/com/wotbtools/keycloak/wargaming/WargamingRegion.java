package com.wotbtools.keycloak.wargaming;

import java.net.URI;
import java.util.Locale;

/**
 * Wargaming.net 区服白名单（认证 Host 与 WoT Blitz 账号 Host 分离）。
 *
 * <p>真实生产契约：认证接口（login/prolongate/logout）由 Wargaming.net ID
 * 认证服务承载，Host 为 {@code api.worldoftanks.{asia|eu|com}/wot/auth/}；
 * WoT Blitz 账号资料接口（account/info）Host 为 {@code api.wotblitz.{asia|eu|com}/wotb/account/}。
 * {@code api.wotblitz.*} 不提供 {@code /wot/auth/*}（真实返回 METHOD_NOT_FOUND），
 * 因此两个 Host 必须分开维护。application_id 按 Blitz 游戏注册、跨区通用。</p>
 *
 * <p>本枚举只接受固定白名单，不接受任何调用方传入的 URL（安全要求）。</p>
 */
enum WargamingRegion {

    ASIA("asia", "api.worldoftanks.asia", "api.wotblitz.asia"),
    EU("eu", "api.worldoftanks.eu", "api.wotblitz.eu"),
    NA("na", "api.worldoftanks.com", "api.wotblitz.com");

    private final String key;
    private final String authHost;
    private final String accountHost;

    WargamingRegion(final String key, final String authHost, final String accountHost) {
        this.key = key;
        this.authHost = authHost;
        this.accountHost = accountHost;
    }

    /**
     * broker id 使用的小写区服段，如 {@code asia} / {@code eu} / {@code na}。
     */
    String key() {
        return key;
    }

    /**
     * 认证 API host（login/prolongate/logout），仅来自白名单。
     */
    String authHost() {
        return authHost;
    }

    /**
     * WoT Blitz 账号 API host（account/info），仅来自白名单。
     */
    String accountHost() {
        return accountHost;
    }

    URI authBase() {
        return URI.create("https://" + authHost + "/wot/auth/");
    }

    URI accountBase() {
        return URI.create("https://" + accountHost + "/wotb/account/");
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
