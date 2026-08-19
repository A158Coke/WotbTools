package com.wotbtools.keycloak.wargaming;

import org.keycloak.models.IdentityProviderModel;

/**
 * Wargaming.net 身份提供方配置。
 *
 * <p>应用 ID 不放在 IdP 配置里（避免密钥进入 Realm 导入配置），由容器环境变量
 * {@code WG_APPLICATION_ID} 提供，见 {@link WargamingIdentityProvider#applicationId()}。
 * 区服由实例配置 {@code region} 决定（ASIA/EU/NA，默认 ASIA），单实例 alias 约定为
 * {@code wargaming-asia}；欧服/美服实例对应 alias {@code wargaming-eu} / {@code wargaming-na}。</p>
 */
public final class WargamingIdentityProviderConfig extends IdentityProviderModel {

    /**
     * Admin Console 配置项 key；取值见 {@link WargamingRegion}。
     */
    public static final String REGION_CONFIG_KEY = "region";

    public WargamingIdentityProviderConfig() {
    }

    public WargamingIdentityProviderConfig(final IdentityProviderModel model) {
        super(model);
    }

    /**
     * 实例区服；未配置或配置了未知值时回退 {@link WargamingRegion#ASIA}（向后兼容）。
     */
    public WargamingRegion region() {
        final WargamingRegion region = WargamingRegion.fromKey(getConfig().get(REGION_CONFIG_KEY));
        return region != null ? region : WargamingRegion.ASIA;
    }
}
