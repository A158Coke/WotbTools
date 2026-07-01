package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.enums.BoosterLevel;
import com.wotb.web.boost.enums.BoosterStatus;
import com.wotb.web.boost.enums.ContactType;
import com.wotb.web.boost.repository.BoosterProfileRepository;
import com.wotb.web.user.repository.UserProfileRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.Optional;

/** 打手管理服务。只操作 booster_profile 表。跨域统计通过 BoostAssignmentService。 */
@Service
public class BoosterService {

    private final BoosterProfileRepository boosterRepository;
    private final BoostStatsService statsService;
    private final UserProfileRepository userProfileRepository;

    public BoosterService(final BoosterProfileRepository boosterRepository,
                          final BoostStatsService statsService,
                          final UserProfileRepository userProfileRepository) {
        this.boosterRepository = boosterRepository;
        this.statsService = statsService;
        this.userProfileRepository = userProfileRepository;
    }

    @Transactional(readOnly = true)
    public BoosterProfile getById(final Long id) {
        return boosterRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("BOOSTER_NOT_FOUND"));
    }

    @Transactional
    public BoosterDto create(final String nickname, final String level,
                             final String keycloakUserId,
                             final Boolean available, final String status,
                             final String contactType, final String contactValue,
                             final String specialties, final String description) {
        if (!StringUtils.hasText(nickname)) throw new IllegalArgumentException("打手昵称不能为空");
        if (level == null) throw new IllegalArgumentException("打手等级不能为空");
        BoosterLevel.from(level);
        if (StringUtils.hasText(keycloakUserId)
                && userProfileRepository.findByKeycloakUserId(keycloakUserId.trim()).isEmpty()) {
            throw new IllegalArgumentException("关联用户不存在");
        }
        final BoosterProfile p = new BoosterProfile();
        p.setNickname(nickname.trim());
        p.setLevel(level.toUpperCase());
        if (StringUtils.hasText(keycloakUserId)) p.setKeycloakUserId(keycloakUserId.trim());
        p.setAvailable(available != null ? available : true);
        p.setStatus(status != null ? status.toUpperCase() : BoosterStatus.ACTIVE.name());
        if (StringUtils.hasText(contactType)) {
            ContactType.from(contactType);
            p.setContactType(contactType.toUpperCase());
        }
        p.setContactValue(contactValue);
        p.setSpecialties(specialties);
        p.setDescription(description);
        boosterRepository.save(p);
        return toDto(p);
    }

    @Transactional
    public BoosterDto update(final Long id, final String nickname, final String level,
                             final String keycloakUserId,
                             final Boolean available, final String status,
                             final String contactType, final String contactValue,
                             final String specialties, final String description) {
        final BoosterProfile p = getById(id);
        if (nickname != null) p.setNickname(nickname.trim());
        if (level != null) { BoosterLevel.from(level); p.setLevel(level.toUpperCase()); }
        if (StringUtils.hasText(keycloakUserId)
                && userProfileRepository.findByKeycloakUserId(keycloakUserId.trim()).isEmpty()) {
            throw new IllegalArgumentException("关联用户不存在");
        }
        if (keycloakUserId != null) p.setKeycloakUserId(keycloakUserId.trim());
        if (available != null) p.setAvailable(available);
        if (status != null) { BoosterStatus.from(status); p.setStatus(status.toUpperCase()); }
        if (StringUtils.hasText(contactType)) { ContactType.from(contactType); p.setContactType(contactType.toUpperCase()); }
        if (contactValue != null) p.setContactValue(contactValue);
        if (specialties != null) p.setSpecialties(specialties);
        if (description != null) p.setDescription(description);
        p.setUpdatedAt(OffsetDateTime.now());
        boosterRepository.save(p);
        return toDto(p);
    }

    @Transactional
    public BoosterDto setAvailability(final Long id, final Boolean available) {
        final BoosterProfile p = getById(id);
        p.setAvailable(available);
        p.setUpdatedAt(OffsetDateTime.now());
        boosterRepository.save(p);
        return toDto(p);
    }

    @Transactional
    public void deleteById(final Long id) {
        boosterRepository.deleteById(id);
    }

    @Transactional(readOnly = true)
    public BoosterDto getDto(final Long id) { return toDto(getById(id)); }

    @Transactional(readOnly = true)
    public Optional<BoosterDto> findByKeycloakUserId(final String keycloakUserId) {
        return boosterRepository.findByKeycloakUserId(keycloakUserId).map(this::toDto);
    }

    @Transactional(readOnly = true)
    public Page<BoosterDto> list(final String status, final Boolean available, final Pageable pageable) {
        final Page<BoosterProfile> page;
        if (status != null && !status.isBlank() && available != null) {
            page = boosterRepository.findByStatusAndAvailable(status, available, pageable);
        } else if (status != null && !status.isBlank()) {
            page = boosterRepository.findByStatus(status, pageable);
        } else if (available != null) {
            page = boosterRepository.findByAvailable(available, pageable);
        } else {
            page = boosterRepository.findAll(pageable);
        }
        return page.map(this::toDto);
    }

    private BoosterDto toDto(final BoosterProfile p) {
        return new BoosterDto(p.getId(), p.getNickname(), p.getLevel(),
                BoosterLevel.from(p.getLevel()).label(), p.getKeycloakUserId(), p.getAvailable(),
                p.getStatus(), BoosterStatus.from(p.getStatus()).label(),
                p.getContactType(), p.getContactValue(), p.getSpecialties(),
                p.getDescription(), (int) statsService.activeAssignmentCount(p.getId()),
                p.getCreatedAt(), p.getUpdatedAt());
    }
}
