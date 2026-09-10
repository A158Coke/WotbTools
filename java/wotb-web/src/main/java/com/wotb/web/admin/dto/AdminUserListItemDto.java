package com.wotb.web.admin.dto;

/**
 * 管理后台用户列表行——Keycloak realm users 与本地 user_profile 的合并视图。
 *
 * <p>数据源有两个 segment，共用本 DTO：</p>
 * <ul>
 *   <li>{@code keycloak}（默认）：行来自 Keycloak realm users，{@code hasLocalProfile}
 *       表示本地是否有绑定资料，{@code keycloakUserMissing} 恒为 false。</li>
 *   <li>{@code local}：行来自本地 user_profile，{@code keycloakUserMissing=true}
 *       表示该 profile 的 Keycloak 用户已不存在（孤儿绑定），可被批量删除以释放
 *       {@code (wotb_server, wotb_account_id)} 唯一槽位。</li>
 * </ul>
 *
 * @param keycloakUserId Keycloak sub（本地 profile 存在或不存在都以它作为行身份）
 * @param keycloakUsername Keycloak 用户名；用户不存在时为 null
 * @param keycloakEmail Keycloak email；用户不存在时为 null
 * @param keycloakEnabled Keycloak 账号是否启用；用户不存在时为 null
 * @param profileId 本地 user_profile 主键；未绑定时为 null
 * @param displayName 本地显示名
 * @param wotbAccountId 绑定的 WotB 游戏账号 ID（HoF canonical owner）
 * @param wotbNickname 绑定的 WotB 昵称
 * @param wotbServer 绑定的区服
 * @param profileCreatedAt 本地 profile 创建时间（ISO-8601）
 * @param hasLocalProfile 本地是否存在 user_profile 行
 * @param keycloakUserMissing Keycloak 侧已无该用户（孤儿本地绑定）
 */
public record AdminUserListItemDto(
        String keycloakUserId,
        String keycloakUsername,
        String keycloakEmail,
        Boolean keycloakEnabled,
        Long profileId,
        String displayName,
        Long wotbAccountId,
        String wotbNickname,
        String wotbServer,
        String profileCreatedAt,
        boolean hasLocalProfile,
        boolean keycloakUserMissing
) {
}
