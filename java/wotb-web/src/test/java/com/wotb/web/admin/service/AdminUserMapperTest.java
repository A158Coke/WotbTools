package com.wotb.web.admin.service;

import com.wotb.web.admin.dto.AdminUserDetailDto;
import org.junit.jupiter.api.Test;
import org.keycloak.representations.idm.FederatedIdentityRepresentation;
import org.keycloak.representations.idm.UserRepresentation;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class AdminUserMapperTest {

    @Test
    void mapsNullableEnabledAndFederatedIdentity() {
        final UserRepresentation user = new UserRepresentation();
        user.setId("user-1");
        user.setUsername("player");
        user.setEnabled(null);
        final FederatedIdentityRepresentation identity = new FederatedIdentityRepresentation();
        identity.setIdentityProvider("qq");
        identity.setUserId("42");
        identity.setUserName("Player");

        final AdminUserDetailDto.KeycloakDto dto = new AdminUserMapper()
                .toKeycloakDto(user, List.of(identity));

        assertFalse(dto.isEnabled());
        assertEquals("qq", dto.getFederatedIdentities().getFirst().getIdentityProvider());
        assertEquals("42", dto.getFederatedIdentities().getFirst().getUserId());
    }
}
