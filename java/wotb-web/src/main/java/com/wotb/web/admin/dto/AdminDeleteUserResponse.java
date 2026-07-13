package com.wotb.web.admin.dto;

/** 管理员删除用户响应 DTO。 */
public class AdminDeleteUserResponse {

    private boolean deleted;
    private String keycloakUserId;
    private boolean localProfileDeleted;
    private boolean keycloakUserDeleted;

    public AdminDeleteUserResponse() {}

    public AdminDeleteUserResponse(final boolean deleted, final String keycloakUserId,
                                   final boolean localProfileDeleted, final boolean keycloakUserDeleted) {
        this.deleted = deleted;
        this.keycloakUserId = keycloakUserId;
        this.localProfileDeleted = localProfileDeleted;
        this.keycloakUserDeleted = keycloakUserDeleted;
    }

    public boolean isDeleted() { return deleted; }
    public String getKeycloakUserId() { return keycloakUserId; }
    public boolean isLocalProfileDeleted() { return localProfileDeleted; }
    public boolean isKeycloakUserDeleted() { return keycloakUserDeleted; }
}
