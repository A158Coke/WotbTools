package com.wotbtools.keycloak.juheqq;

import org.keycloak.models.IdentityProviderModel;

public final class JuheQqIdentityProviderConfig extends IdentityProviderModel {

    public static final String CONFIG_APPID = "appid";
    public static final String CONFIG_APP_KEY = "appkey";
    public static final String CONFIG_LOGIN_BASE_URL = "loginBaseUrl";
    public static final String DEFAULT_LOGIN_BASE_URL = "https://open.juhedenglu.cn/connect.php";

    public JuheQqIdentityProviderConfig() {
    }

    public JuheQqIdentityProviderConfig(final IdentityProviderModel model) {
        super(model);
    }

    public String getAppid() {
        return getConfig().get(CONFIG_APPID);
    }

    public String getAppkey() {
        return getConfig().get(CONFIG_APP_KEY);
    }

    public String getLoginBaseUrl() {
        final String url = getConfig().get(CONFIG_LOGIN_BASE_URL);
        return (url != null && !url.isBlank()) ? url : DEFAULT_LOGIN_BASE_URL;
    }
}
