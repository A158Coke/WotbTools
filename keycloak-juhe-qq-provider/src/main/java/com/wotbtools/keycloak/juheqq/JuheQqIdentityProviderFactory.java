package com.wotbtools.keycloak.juheqq;

import org.keycloak.broker.provider.AbstractIdentityProviderFactory;
import org.keycloak.models.IdentityProviderModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.provider.ProviderConfigProperty;

import java.util.ArrayList;
import java.util.List;

public final class JuheQqIdentityProviderFactory
        extends AbstractIdentityProviderFactory<JuheQqIdentityProvider> {

    public static final String PROVIDER_ID = "juhe-qq";

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getName() {
        return "Juhe QQ";
    }

    @Override
    public JuheQqIdentityProvider create(final KeycloakSession session,
                                         final IdentityProviderModel model) {
        return new JuheQqIdentityProvider(session, new JuheQqIdentityProviderConfig(model));
    }

    @Override
    public JuheQqIdentityProviderConfig createConfig() {
        return new JuheQqIdentityProviderConfig();
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        final List<ProviderConfigProperty> props = new ArrayList<>();

        final ProviderConfigProperty appid = new ProviderConfigProperty();
        appid.setName(JuheQqIdentityProviderConfig.CONFIG_APPID);
        appid.setLabel("APPID");
        appid.setHelpText("聚合登录平台分配的 APPID");
        appid.setType(ProviderConfigProperty.STRING_TYPE);
        props.add(appid);

        final ProviderConfigProperty appkey = new ProviderConfigProperty();
        appkey.setName(JuheQqIdentityProviderConfig.CONFIG_APP_KEY);
        appkey.setLabel("APPKEY");
        appkey.setHelpText("聚合登录平台分配的 APPKEY（加密存储，不打印日志）");
        appkey.setType(ProviderConfigProperty.STRING_TYPE);
        appkey.setSecret(true);
        props.add(appkey);

        final ProviderConfigProperty loginBaseUrl = new ProviderConfigProperty();
        loginBaseUrl.setName(JuheQqIdentityProviderConfig.CONFIG_LOGIN_BASE_URL);
        loginBaseUrl.setLabel("Login Base URL");
        loginBaseUrl.setHelpText("聚合登录平台接口地址");
        loginBaseUrl.setType(ProviderConfigProperty.STRING_TYPE);
        loginBaseUrl.setDefaultValue(JuheQqIdentityProviderConfig.DEFAULT_LOGIN_BASE_URL);
        props.add(loginBaseUrl);

        return props;
    }
}
