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
     * @param idpAlias 仅 keycloak segment 支持的身份提供方过滤（第三方 IdP 用户清理前提）
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

    @DeleteMapping
    public DeleteUsersResponse deleteUsers(
            @RequestBody final List<String> keycloakUserIds,
            @RequestParam(name = "confirm", defaultValue = "false") final boolean confirm,
            @AuthenticationPrincipal final Jwt jwt) {
        return adminUserService.deleteUsers(keycloakUserIds, confirm, jwt);
    }
}
