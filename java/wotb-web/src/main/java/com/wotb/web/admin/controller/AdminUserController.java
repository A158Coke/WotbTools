package com.wotb.web.admin.controller;

import com.wotb.web.admin.dto.AdminUserDetailDto;
import com.wotb.web.admin.dto.AdminUserPageDto;
import com.wotb.web.admin.dto.DeleteUsersResponse;
import com.wotb.web.admin.service.AdminUserService;
import com.wotb.web.config.ApiPaths;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 管理员用户管理 API。需要 wotbtools-admin 角色。 */
@RestController
@RequestMapping(ApiPaths.ADMIN_USERS)
public class AdminUserController {

    private final AdminUserService adminUserService;

    public AdminUserController(final AdminUserService adminUserService) {
        this.adminUserService = adminUserService;
    }

    /**
     * 用户列表（Keycloak 与本地 profile 的合并视图，服务端分页）。
     *
     * @param segment  keycloak（默认，权威源为 Keycloak，可发现无本地资料的 Keycloak-only 用户）
     *                 或 local（权威源为本地 user_profile，暴露 Keycloak 侧已不存在的孤儿绑定）
     * @param idpAlias 仅 keycloak segment 支持的身份提供方过滤（Juhe QQ cleanup 前提）
     */
    @GetMapping
    public AdminUserPageDto searchUsers(
            @RequestParam(name = "query", required = false) final String query,
            @RequestParam(name = "segment", required = false) final String segment,
            @RequestParam(name = "idpAlias", required = false) final String idpAlias,
            @RequestParam(name = "page", defaultValue = "0") final int page,
            @RequestParam(name = "size", defaultValue = "25") final int size) {
        return adminUserService.searchUsers(query, segment, idpAlias, page, size);
    }

    @GetMapping("/{keycloakUserId}")
    public AdminUserDetailDto getUser(@PathVariable final String keycloakUserId) {
        return adminUserService.getUser(keycloakUserId);
    }

    /**
     * 删除用户：请求体是 Keycloak sub 的 JSON 数组——删除单个用户就是长度为 1 的数组，
     * 因此没有单独的「批量删除」端点，也没有单条 {@code /{keycloakUserId}} 删除端点。
     *
     * <p>逐用户复用删除业务保护并允许 partial success，响应始终是逐用户结果。</p>
     */
    @DeleteMapping
    public DeleteUsersResponse deleteUsers(
            @RequestBody final List<String> keycloakUserIds,
            @RequestParam(name = "confirm", defaultValue = "false") final boolean confirm,
            @AuthenticationPrincipal final Jwt jwt) {
        return adminUserService.deleteUsers(keycloakUserIds, confirm, jwt);
    }
}
