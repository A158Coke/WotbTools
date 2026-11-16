package com.wotb.web.user.service;

import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

abstract class UserProfileServiceTestSupport {

    UserProfileRepository repository;
    UserProfileService service;

    @BeforeEach
    void setUp() {
        repository = mock(UserProfileRepository.class);
        when(repository.save(any(UserProfile.class))).thenAnswer(inv -> inv.getArgument(0));
        when(repository.saveAndFlush(any(UserProfile.class))).thenAnswer(inv -> inv.getArgument(0));
        service = new UserProfileService(repository, new UserProfileMapper());
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    static void loginWithWgClaims(final String region, final boolean verified,
                                          final Long accountId) {
        final Jwt jwt = Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject("kc-user")
                .claim("preferred_username", "512345678")
                .claim("displayName", "PlayerOne")
                .claim("wotb_region", region)
                .claim("wotb_account_id", accountId == null ? null : String.valueOf(accountId))
                .claim("wotb_nickname", "PlayerOne")
                .claim("wotb_verified", verified)
                .build();
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(jwt, null));
    }

    static UserProfile wgProfile(final String region, final Long accountId,
                                         final String nickname,
                                         final OffsetDateTime verifiedAt) {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-user");
        profile.setUsername("512345678");
        profile.setWotbServer(region);
        profile.setWotbAccountId(accountId);
        profile.setWotbNickname(nickname);
        profile.setWotbAccountSource("WARGAMING");
        profile.setWotbAccountVerifiedAt(verifiedAt);
        return profile;
    }

    /** CN / QQ 手动绑定 profile（回放验证的目标形态）。 */
    static UserProfile cnProfile(final Long accountId, final String nickname,
                                         final OffsetDateTime verifiedAt) {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-user");
        profile.setUsername("qq-user");
        profile.setWotbServer("CN");
        profile.setWotbAccountId(accountId);
        profile.setWotbNickname(nickname);
        profile.setWotbAccountSource("MANUAL");
        profile.setWotbAccountVerifiedAt(verifiedAt);
        return profile;
    }

}
