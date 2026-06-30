package com.wotb.web.admin.dto;

import java.util.List;

/** 管理员用户详情 DTO。包含本地 profile + Keycloak 信息。 */
public class AdminUserDetailDto {

    private String keycloakUserId;
    private ProfileDto profile;
    private KeycloakDto keycloak;
    private List<String> warnings;

    public AdminUserDetailDto() {}

    public AdminUserDetailDto(final String keycloakUserId, final ProfileDto profile,
                              final KeycloakDto keycloak, final List<String> warnings) {
        this.keycloakUserId = keycloakUserId;
        this.profile = profile;
        this.keycloak = keycloak;
        this.warnings = warnings;
    }

    public String getKeycloakUserId() { return keycloakUserId; }
    public ProfileDto getProfile() { return profile; }
    public KeycloakDto getKeycloak() { return keycloak; }
    public List<String> getWarnings() { return warnings; }

    public static class ProfileDto {
        private Long id;
        private String displayName;
        private Long wotbAccountId;
        private String wotbNickname;
        private String wotbServer;
        private String createdAt;
        private String updatedAt;

        public ProfileDto() {}
        public Long getId() { return id; }
        public void setId(final Long id) { this.id = id; }
        public String getDisplayName() { return displayName; }
        public void setDisplayName(final String displayName) { this.displayName = displayName; }
        public Long getWotbAccountId() { return wotbAccountId; }
        public void setWotbAccountId(final Long wotbAccountId) { this.wotbAccountId = wotbAccountId; }
        public String getWotbNickname() { return wotbNickname; }
        public void setWotbNickname(final String wotbNickname) { this.wotbNickname = wotbNickname; }
        public String getWotbServer() { return wotbServer; }
        public void setWotbServer(final String wotbServer) { this.wotbServer = wotbServer; }
        public String getCreatedAt() { return createdAt; }
        public void setCreatedAt(final String createdAt) { this.createdAt = createdAt; }
        public String getUpdatedAt() { return updatedAt; }
        public void setUpdatedAt(final String updatedAt) { this.updatedAt = updatedAt; }
    }

    public static class KeycloakDto {
        private String id;
        private String username;
        private String email;
        private String firstName;
        private String lastName;
        private boolean enabled;
        private List<FederatedIdentityDto> federatedIdentities;

        public KeycloakDto() {}
        public String getId() { return id; }
        public void setId(final String id) { this.id = id; }
        public String getUsername() { return username; }
        public void setUsername(final String username) { this.username = username; }
        public String getEmail() { return email; }
        public void setEmail(final String email) { this.email = email; }
        public String getFirstName() { return firstName; }
        public void setFirstName(final String firstName) { this.firstName = firstName; }
        public String getLastName() { return lastName; }
        public void setLastName(final String lastName) { this.lastName = lastName; }
        public boolean isEnabled() { return enabled; }
        public void setEnabled(final boolean enabled) { this.enabled = enabled; }
        public List<FederatedIdentityDto> getFederatedIdentities() { return federatedIdentities; }
        public void setFederatedIdentities(final List<FederatedIdentityDto> federatedIdentities) { this.federatedIdentities = federatedIdentities; }
    }

    public static class FederatedIdentityDto {
        private String identityProvider;
        private String userId;
        private String userName;

        public FederatedIdentityDto() {}
        public String getIdentityProvider() { return identityProvider; }
        public void setIdentityProvider(final String identityProvider) { this.identityProvider = identityProvider; }
        public String getUserId() { return userId; }
        public void setUserId(final String userId) { this.userId = userId; }
        public String getUserName() { return userName; }
        public void setUserName(final String userName) { this.userName = userName; }
    }
}
