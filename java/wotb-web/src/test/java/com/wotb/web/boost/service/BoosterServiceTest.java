package com.wotb.web.boost.service;

import com.wotb.web.boost.repository.BoosterProfileRepository;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BoosterServiceTest {

    @Mock
    BoosterProfileRepository boosterRepository;

    @Mock
    BoosterMapper mapper;

    @Mock
    UserProfileRepository userProfileRepository;

    BoosterService service;

    @BeforeEach
    void setUp() {
        service = new BoosterService(boosterRepository, mapper, userProfileRepository);
    }

    @Test
    void shouldRejectDuplicateKeycloakUserId() {
        when(userProfileRepository.findByKeycloakUserId(eq("kc-user-1")))
                .thenReturn(Optional.of(new UserProfile()));
        when(boosterRepository.findByKeycloakUserId(eq("kc-user-1")))
                .thenReturn(Optional.of(new BoosterProfile()));

        assertThatThrownBy(() -> service.create("TestBooster", "ELITE",
                "kc-user-1", true, "ACTIVE",
                "QQ", "123", "专精中坦", "专业打手"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("该用户已是打手");
    }

    @Test
    void shouldRejectWhenUserProfileNotFound() {
        when(userProfileRepository.findByKeycloakUserId(eq("kc-unknown"))).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.create("TestBooster", "ELITE",
                "kc-unknown", true, "ACTIVE",
                "QQ", "123", "专精中坦", "专业打手"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("关联用户不存在");
    }

    @Test
    void shouldRejectEmptyNickname() {
        assertThatThrownBy(() -> service.create("", "ELITE",
                null, true, "ACTIVE",
                "QQ", "123", null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("打手昵称不能为空");
    }

    @Test
    void shouldRejectNullLevel() {
        assertThatThrownBy(() -> service.create("TestBooster", null,
                null, true, "ACTIVE",
                "QQ", "123", null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("打手等级不能为空");
    }

    @Test
    void shouldRejectInvalidLevel() {
        assertThatThrownBy(() -> service.create("TestBooster", "GOD",
                null, true, "ACTIVE",
                "QQ", "123", null, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void shouldPersistBoosterWhenValid() {
        when(userProfileRepository.findByKeycloakUserId(eq("kc-new")))
                .thenReturn(Optional.of(new UserProfile()));
        when(boosterRepository.findByKeycloakUserId(any())).thenReturn(Optional.empty());
        when(boosterRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        service.create("TestBooster", "ELITE",
                "kc-new", true, "ACTIVE",
                "QQ", "123", "专精中坦", "专业打手");

        verify(boosterRepository).save(any());
    }
}
