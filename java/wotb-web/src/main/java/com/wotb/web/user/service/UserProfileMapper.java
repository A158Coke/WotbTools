package com.wotb.web.user.service;

import com.wotb.web.util.Mapper;
import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.entity.UserProfile;
import org.springframework.stereotype.Service;

@Service
public class UserProfileMapper implements Mapper<UserProfile, UserProfileDto> {

    @Override
    public UserProfileDto toDto(final UserProfile p) {
        return new UserProfileDto(
                p.getId(), p.getKeycloakUserId(), p.getDisplayName(),
                p.getUsername(),
                p.getWotbAccountId(), p.getWotbNickname(), p.getWotbServer()
        );
    }
}
