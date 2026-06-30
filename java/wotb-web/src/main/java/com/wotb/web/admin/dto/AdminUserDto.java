package com.wotb.web.admin.dto;

/** 管理员用户搜索列表 DTO。 */
public class AdminUserDto {

    private String keycloakUserId;
    private Long profileId;
    private String displayName;
    private Long wotbAccountId;
    private String wotbNickname;
    private String wotbServer;
    private String keycloakUsername;
    private String keycloakEmail;
    private String createdAt;
    private String source;

    public AdminUserDto() {}

    public AdminUserDto(final String keycloakUserId, final Long profileId, final String displayName,
                        final Long wotbAccountId, final String wotbNickname, final String wotbServer,
                        final String keycloakUsername, final String keycloakEmail,
                        final String createdAt, final String source) {
        this.keycloakUserId = keycloakUserId;
        this.profileId = profileId;
        this.displayName = displayName;
        this.wotbAccountId = wotbAccountId;
        this.wotbNickname = wotbNickname;
        this.wotbServer = wotbServer;
        this.keycloakUsername = keycloakUsername;
        this.keycloakEmail = keycloakEmail;
        this.createdAt = createdAt;
        this.source = source;
    }

    public String getKeycloakUserId() { return keycloakUserId; }
    public Long getProfileId() { return profileId; }
    public String getDisplayName() { return displayName; }
    public Long getWotbAccountId() { return wotbAccountId; }
    public String getWotbNickname() { return wotbNickname; }
    public String getWotbServer() { return wotbServer; }
    public String getKeycloakUsername() { return keycloakUsername; }
    public String getKeycloakEmail() { return keycloakEmail; }
    public String getCreatedAt() { return createdAt; }
    public String getSource() { return source; }
}
