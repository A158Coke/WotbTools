package com.wotbtools.keycloak.wargaming;

import org.keycloak.models.IdentityProviderModel;

/**
 * Wargaming.net 身份提供方配置。
 *
 * <p>应用 ID 不放在 IdP 配置里（避免密钥进入 Realm 导入配置），由容器环境变量
 * {@code WG_APPLICATION_ID} 提供，见 {@link WargamingIdentityProvider#applicationId()}。
 * 区服固定 ASIA，单实例 alias 约定为 {@code wargaming-asia}。</p>
 */
public final class WargamingIdentityProviderConfig extends IdentityProviderModel {

    public WargamingIdentityProviderConfig() {
    }

    public WargamingIdentityProviderConfig(final IdentityProviderModel model) {
        super(model);
    }
}
