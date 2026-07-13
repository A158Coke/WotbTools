package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostRequestDto;
import com.wotb.web.boost.dto.CreateBoostRequestResponse;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.enums.BoostRegion;
import com.wotb.web.boost.enums.BoostRequestStatus;
import com.wotb.web.boost.enums.BoostRequestType;
import com.wotb.web.boost.enums.ContactType;
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import com.wotb.web.boost.repository.BoostRequestRepository;
import org.springframework.data.domain.Page;
import org.springframework.util.StringUtils;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** 玩家侧需求服务。 */
@Service
public class BoostRequestService {

    private final BoostRequestRepository repository;
    private final BoostRequestAssignmentRepository assignmentRepository;
    private final BoostRequestMapper mapper;

    private static final Set<String> SENSITIVE_KEYWORDS = Set.of(
            "密码", "验证码", "账号密码", "登录密码", "password", "verification code"
    );

    public BoostRequestService(final BoostRequestRepository repository,
                               final BoostRequestAssignmentRepository assignmentRepository,
                               final BoostRequestMapper mapper) {
        this.repository = repository;
        this.assignmentRepository = assignmentRepository;
        this.mapper = mapper;
    }

    /** 创建陪练需求。 */
    @Transactional
    public CreateBoostRequestResponse create(final String requesterUserId,
                                             final String region,
                                             final String requestType,
                                             final String targetDescription,
                                             final String contactType,
                                             final String contactValue,
                                             final Long playerAccountId,
                                             final String playerNickname,
                                             final String budgetRange,
                                             final String availableTime,
                                             final String remark) {
        // 校验 region
        final String effectiveRegion = BoostRegion.from(
                StringUtils.hasText(region) ? region.trim() : "CN"
        ).name();

        // 校验 requestType
        final String effectiveRequestType = BoostRequestType.from(requestType).name();

        // 校验 contactType
        final String effectiveContactType = ContactType.from(contactType).name();

        // 敏感词检查
        checkSensitive(targetDescription);
        checkSensitive(remark);

        // 校验必填
        if (!StringUtils.hasText(targetDescription)) {
            throw new IllegalArgumentException("TARGET_DESCRIPTION_REQUIRED");
        }
        if (!StringUtils.hasText(contactValue)) {
            throw new IllegalArgumentException("CONTACT_VALUE_REQUIRED");
        }

        final BoostRequest req = new BoostRequest();
        req.setRequesterUserId(requesterUserId);
        req.setRegion(effectiveRegion);
        req.setRequestType(effectiveRequestType);
        req.setTargetDescription(targetDescription.trim());
        req.setContactType(effectiveContactType);
        req.setContactValue(contactValue.trim());
        req.setPlayerAccountId(playerAccountId);
        req.setPlayerNickname(playerNickname);
        req.setBudgetRange(budgetRange);
        req.setAvailableTime(availableTime);
        req.setRemark(remark);
        req.setStatus(BoostRequestStatus.NEW.name());
        req.setUpdatedAt(OffsetDateTime.now());

        repository.save(req);

        return new CreateBoostRequestResponse(
                req.getId(),
                req.getStatus(),
                "BOOST_REQUEST_SUBMITTED",
                req.getCreatedAt()
        );
    }

    /** 查询当前用户的需求列表。 */
    public List<BoostRequestDto> listMy(final String requesterUserId) {
        return repository.findByRequesterUserIdOrderByCreatedAtDesc(requesterUserId)
                .stream()
                .map(request -> mapper.toDto(request, hasActiveAssignment(request)))
                .toList();
    }

    /** 查询当前用户单个需求。 */
    public Optional<BoostRequestDto> getMy(final Long id, final String requesterUserId) {
        return repository.findByIdAndRequesterUserId(id, requesterUserId)
                .map(request -> mapper.toDto(request, hasActiveAssignment(request)));
    }

    /** 取消自己的需求。 */
    @Transactional
    public BoostRequestDto cancel(final Long id, final String requesterUserId) {
        final BoostRequest req = repository.findByIdAndRequesterUserId(id, requesterUserId)
                .orElseThrow(() -> new IllegalArgumentException("REQUEST_NOT_FOUND"));

        final BoostRequestStatus currentStatus = BoostRequestStatus.from(req.getStatus());
        if (currentStatus != BoostRequestStatus.NEW && currentStatus != BoostRequestStatus.REVIEWING) {
            throw new IllegalArgumentException("REQUEST_STATUS_NOT_CANCELLABLE");
        }

        req.setStatus(BoostRequestStatus.CANCELLED.name());
        req.setUpdatedAt(OffsetDateTime.now());
        repository.save(req);

        return mapper.toDto(req, hasActiveAssignment(req));
    }

    // --- 管理员侧委托方法 ---

    public Page<BoostRequest> findAll(final Pageable pageable) {
        return repository.findAll(pageable);
    }

    public Page<BoostRequest> findByStatus(final String status, final Pageable pageable) {
        return repository.findByStatus(status, pageable);
    }

    public BoostRequest getById(final Long id) {
        return repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("REQUEST_NOT_FOUND"));
    }

    private boolean hasActiveAssignment(final BoostRequest request) {
        return assignmentRepository.findByRequestIdAndUnassignedAtIsNull(request.getId()).isPresent();
    }

    private static void checkSensitive(final String text) {
        if (!StringUtils.hasText(text)) { return; }
        final String lower = text.toLowerCase();
        for (final String kw : SENSITIVE_KEYWORDS) {
            if (lower.contains(kw)) {
                throw new IllegalArgumentException("SENSITIVE_INFO_NOT_ALLOWED");
            }
        }
    }
}
