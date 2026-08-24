package com.wotb.web.hundred.gateway;

import java.net.URI;

/** WG 官方 WoT Blitz 统计 API 的固定国际服 host 白名单。 */
public enum WargamingServer {
    ASIA("api.wotblitz.asia"),
    EU("api.wotblitz.eu"),
    NA("api.wotblitz.com");

    private final String host;

    WargamingServer(final String host) {
        this.host = host;
    }

    URI accountApiBase() {
        return URI.create("https://" + host + "/wotb/");
    }

    /** 只接受可信 JWT/Profile 的稳定大写码，未知值不可表达为任意 host。 */
    public static WargamingServer fromCode(final String code) {
        if (code == null) {
            return null;
        }
        return switch (code) {
            case "ASIA" -> ASIA;
            case "EU" -> EU;
            case "NA" -> NA;
            default -> null;
        };
    }
}
