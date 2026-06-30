package com.wotb.web.admin;

import com.wotb.web.admin.dto.AdminDeleteUserResponse;
import com.wotb.web.admin.dto.AdminUserDetailDto;
import com.wotb.web.admin.dto.AdminUserDto;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 管理员用户管理 API。需要 wotbtools-admin 角色。 */
@RestController
@RequestMapping("/api/admin/users")
public class AdminUserController {

    private final AdminUserService adminUserService;

    public AdminUserController(final AdminUserService adminUserService) {
        this.adminUserService = adminUserService;
    }

    @GetMapping
    public List<AdminUserDto> searchUsers(
            @RequestParam(required = false) final String query,
            @RequestParam(defaultValue = "50") final int limit) {
        return adminUserService.searchUsers(query, limit);
    }

    @GetMapping("/{keycloakUserId}")
    public AdminUserDetailDto getUser(@PathVariable final String keycloakUserId) {
        return adminUserService.getUser(keycloakUserId);
    }

    @DeleteMapping("/{keycloakUserId}")
    public AdminDeleteUserResponse deleteUser(
            @PathVariable final String keycloakUserId,
            @RequestParam(defaultValue = "false") final boolean confirm,
            @AuthenticationPrincipal final Jwt jwt) {
        return adminUserService.deleteUser(keycloakUserId, confirm, jwt);
    }
}
