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
import org.apache.poi.util.StringUtil;
import org.springframework.data.domain.Page;
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

    private static final Set<String> SENSITIVE_KEYWORDS = Set.of(
            "密码", "验证码", "账号密码", "登录密码", "password", "verification code"
    );

    public BoostRequestService(final BoostRequestRepository repository,
                               final BoostRequestAssignmentRepository assignmentRepository) {
        this.repository = repository;
        this.assignmentRepository = assignmentRepository;
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
        final String effectiveRegion = region != null ? region : "CN";
        BoostRegion.from(effectiveRegion);

        // 校验 requestType
        BoostRequestType.from(requestType);

        // 校验 contactType
        ContactType.from(contactType);

        // 敏感词检查
        checkSensitive(targetDescription);
        checkSensitive(remark);

        // 校验必填
        if (StringUtil.isBlank(targetDescription)) {
            throw new IllegalArgumentException("目标描述不能为空");
        }
        if (StringUtil.isBlank(contactValue)) {
            throw new IllegalArgumentException("联系方式不能为空");
        }

        final BoostRequest req = new BoostRequest();
        req.setRequesterUserId(requesterUserId);
        req.setRegion(effectiveRegion.toUpperCase());
        req.setRequestType(requestType.toUpperCase());
        req.setTargetDescription(targetDescription.trim());
        req.setContactType(contactType.toUpperCase());
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
                "需求已提交，管理员会人工审核并联系你。",
                req.getCreatedAt()
        );
    }

    /** 查询当前用户的需求列表。 */
    public List<BoostRequestDto> listMy(final String requesterUserId) {
        return repository.findByRequesterUserIdOrderByCreatedAtDesc(requesterUserId)
                .stream()
                .map(this::toPlayerDto)
                .toList();
    }

    /** 查询当前用户单个需求。 */
    public Optional<BoostRequestDto> getMy(final Long id, final String requesterUserId) {
        return repository.findByIdAndRequesterUserId(id, requesterUserId)
                .map(this::toPlayerDto);
    }

    /** 取消自己的需求。 */
    @Transactional
    public BoostRequestDto cancel(final Long id, final String requesterUserId) {
        final BoostRequest req = repository.findByIdAndRequesterUserId(id, requesterUserId)
                .orElseThrow(() -> new IllegalArgumentException("REQUEST_NOT_FOUND"));

        final String currentStatus = req.getStatus().toUpperCase();
        if (!currentStatus.equals("NEW") && !currentStatus.equals("REVIEWING")) {
            throw new IllegalArgumentException("当前状态不允许取消");
        }

        req.setStatus(BoostRequestStatus.CANCELLED.name());
        req.setUpdatedAt(OffsetDateTime.now());
        repository.save(req);

        return toPlayerDto(req);
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

    /** 转为玩家侧 DTO — 联系方式脱敏、不暴露 adminNote。 */
    BoostRequestDto toPlayerDto(final BoostRequest req) {
        final var active = assignmentRepository.findByRequestIdAndUnassignedAtIsNull(req.getId());
        return new BoostRequestDto(
                req.getId(),
                req.getPlayerAccountId(),
                req.getPlayerNickname(),
                req.getRegion(),
                BoostRegion.from(req.getRegion()).label(),
                req.getRequestType(),
                BoostRequestType.from(req.getRequestType()).label(),
                req.getTargetDescription(),
                req.getBudgetRange(),
                req.getContactType(),
                maskContact(req.getContactValue()),
                req.getAvailableTime(),
                req.getRemark(),
                req.getStatus(),
                BoostRequestStatus.from(req.getStatus()).label(),
                active.isPresent(),
                req.getCreatedAt(),
                req.getUpdatedAt()
        );
    }

    /** 联系方式脱敏。 */
    static String maskContact(final String value) {
        if (value == null) { return null; }
        final int len = value.length();
        if (len <= 3) { return "***"; }
        if (len <= 7) {
            return value.charAt(0) + "***" + value.charAt(len - 1);
        }
        return value.substring(0, 3) + "****" + value.substring(len - 3);
    }

    private static void checkSensitive(final String text) {
        if (text == null) { return; }
        final String lower = text.toLowerCase();
        for (final String kw : SENSITIVE_KEYWORDS) {
            if (lower.contains(kw)) {
                throw new IllegalArgumentException("SENSITIVE_INFO_NOT_ALLOWED");
            }
        }
    }
}
