package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.dto.ConfirmBoostRequestResponse;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.enums.BoostAssignmentStatus;
import com.wotb.web.boost.enums.BoostRequestStatus;
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import com.wotb.web.user.enums.UserNotificationType;
import com.wotb.web.user.service.UserNotificationService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class BoostAssignmentService {

    private static final String SUBJECT_TYPE = "boost_request";
    private static final int AUTO_CONFIRM_BATCH_SIZE = 100;

    private final BoostRequestAssignmentRepository assignmentRepository;
    private final BoostRequestService requestService;
    private final BoosterService boosterService;
    private final BoostAssignmentMapper mapper;
    private final UserNotificationService notificationService;
    private final long autoConfirmHours;

    public BoostAssignmentService(final BoostRequestAssignmentRepository assignmentRepository,
                                  final BoostRequestService requestService,
                                  final BoosterService boosterService,
                                  final BoostAssignmentMapper mapper,
                                  final UserNotificationService notificationService,
                                  @Value("${wotb.boost.auto-confirm-hours}") final long autoConfirmHours) {
        this.assignmentRepository = assignmentRepository;
        this.requestService = requestService;
        this.boosterService = boosterService;
        this.mapper = mapper;
        this.notificationService = notificationService;
        if (autoConfirmHours <= 0) {
            throw new IllegalArgumentException("BOOST_AUTO_CONFIRM_HOURS_INVALID");
        }
        this.autoConfirmHours = autoConfirmHours;
    }

    public Optional<BoostRequestAssignment> findActive(final Long requestId) {
        return assignmentRepository.findByRequestIdAndUnassignedAtIsNull(requestId);
    }

    @Transactional(readOnly = true)
    public List<BoostAssignmentDto> findByBooster(final Long boosterId, final boolean includeHistory) {
        final BoosterProfile booster = boosterService.getById(boosterId);
        final List<BoostRequestAssignment> assignments = includeHistory
                ? assignmentRepository.findByBoosterIdOrderByAssignedAtDesc(boosterId)
                : assignmentRepository.findByBoosterIdAndUnassignedAtIsNull(boosterId);

        return assignments
                .stream()
                // Active assignments stay on top when the profile asks for history.
                .sorted(Comparator
                        .comparing((BoostRequestAssignment assignment) -> assignment.getUnassignedAt() != null)
                        .thenComparing(BoostRequestAssignment::getAssignedAt, Comparator.reverseOrder()))
                .map(a -> {
                    final BoostRequest req = requestService.getById(a.getRequestId());
                    return mapper.toDto(a, booster, req);
                })
                .toList();
    }

    @Transactional
    public BoostAssignmentDto assign(final Long requestId, final Long boosterId, final String note) {
        final BoostRequest req = requestService.getByIdForUpdate(requestId);
        if (assignmentRepository.findByRequestIdAndUnassignedAtIsNull(requestId).isPresent()) {
            throw new IllegalStateException("ACTIVE_ASSIGNMENT_EXISTS");
        }

        final BoostRequestStatus status = BoostRequestStatus.from(req.getStatus());
        if (status != BoostRequestStatus.NEW && status != BoostRequestStatus.REVIEWING) {
            throw new IllegalArgumentException("REQUEST_STATUS_NOT_ASSIGNABLE");
        }

        final BoosterProfile booster = boosterService.getByIdForUpdate(boosterId);
        if (!"ACTIVE".equalsIgnoreCase(booster.getStatus())) {
            throw new IllegalArgumentException("BOOSTER_NOT_ACTIVE");
        }
        if (booster.getAvailable() == null || !booster.getAvailable()) {
            throw new IllegalArgumentException("BOOSTER_UNAVAILABLE");
        }
        if (assignmentRepository.countByBoosterIdAndUnassignedAtIsNull(boosterId) > 0) {
            throw new IllegalArgumentException("BOOSTER_BUSY");
        }

        final OffsetDateTime now = OffsetDateTime.now();
        final BoostRequestAssignment assignment = new BoostRequestAssignment();
        assignment.setRequestId(requestId);
        assignment.setBoosterId(boosterId);
        assignment.setStatus(BoostAssignmentStatus.ASSIGNED.name());
        assignment.setAssignedAt(now);
        assignment.setUpdatedAt(now);
        assignment.setNote(note);
        assignmentRepository.save(assignment);

        req.setStatus(BoostRequestStatus.MATCHED.name());
        req.setCompletionSubmittedAt(null);
        req.setAutoConfirmAt(null);
        req.setUpdatedAt(now);

        notifyBooster(booster, UserNotificationType.BOOST_ASSIGNMENT_RECEIVED, req, assignment);
        notifyRequester(req, UserNotificationType.BOOST_REQUEST_ASSIGNED, assignment);
        return mapper.toDto(assignment, booster, req);
    }

    @Transactional
    public BoostAssignmentDto acceptByBooster(final Long assignmentId, final Long boosterId) {
        final LockedAssignment locked = lockActiveAssignmentForBooster(assignmentId, boosterId);
        final BoostRequestAssignment assignment = locked.assignment();
        final BoostRequest req = locked.request();
        requireAssignmentStatus(assignment, BoostAssignmentStatus.ASSIGNED);
        requireRequestStatus(req, BoostRequestStatus.MATCHED);
        final OffsetDateTime now = OffsetDateTime.now();
        assignment.setStatus(BoostAssignmentStatus.ACCEPTED.name());
        assignment.setUpdatedAt(now);
        req.setStatus(BoostRequestStatus.ACCEPTED.name());
        req.setUpdatedAt(now);
        notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_ACCEPTED, assignment);
        return mapper.toDto(assignment, boosterService.getById(boosterId), req);
    }

    @Transactional
    public BoostAssignmentDto startByBooster(final Long assignmentId, final Long boosterId) {
        final LockedAssignment locked = lockActiveAssignmentForBooster(assignmentId, boosterId);
        final BoostRequestAssignment assignment = locked.assignment();
        final BoostRequest req = locked.request();
        requireAssignmentStatus(assignment, BoostAssignmentStatus.ACCEPTED);
        requireRequestStatus(req, BoostRequestStatus.ACCEPTED);
        final OffsetDateTime now = OffsetDateTime.now();
        assignment.setStatus(BoostAssignmentStatus.IN_PROGRESS.name());
        assignment.setUpdatedAt(now);
        req.setStatus(BoostRequestStatus.IN_PROGRESS.name());
        req.setUpdatedAt(now);
        notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_IN_PROGRESS, assignment);
        return mapper.toDto(assignment, boosterService.getById(boosterId), req);
    }

    @Transactional
    public BoostAssignmentDto completeByBooster(final Long assignmentId, final Long boosterId, final String note) {
        final LockedAssignment locked = lockActiveAssignmentForBooster(assignmentId, boosterId);
        final BoostRequestAssignment assignment = locked.assignment();
        final BoostRequest req = locked.request();
        final BoostAssignmentStatus status = BoostAssignmentStatus.from(assignment.getStatus());
        if (status != BoostAssignmentStatus.ACCEPTED && status != BoostAssignmentStatus.IN_PROGRESS) {
            throw new IllegalArgumentException("ASSIGNMENT_STATUS_NOT_COMPLETABLE");
        }
        final BoostRequestStatus requestStatus = BoostRequestStatus.from(req.getStatus());
        if (requestStatus != BoostRequestStatus.ACCEPTED && requestStatus != BoostRequestStatus.IN_PROGRESS) {
            throw new IllegalArgumentException("REQUEST_STATUS_NOT_COMPLETABLE");
        }
        requireMatchingAssignmentStatus(requestStatus, assignment);
        final OffsetDateTime now = OffsetDateTime.now();
        assignment.setStatus(BoostAssignmentStatus.PENDING_CONFIRM.name());
        assignment.setNote(note);
        assignment.setUpdatedAt(now);
        req.setStatus(BoostRequestStatus.PENDING_CONFIRM.name());
        req.setCompletionSubmittedAt(now);
        req.setAutoConfirmAt(now.plusHours(autoConfirmHours));
        req.setUpdatedAt(now);
        notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_PENDING_CONFIRM, assignment);
        return mapper.toDto(assignment, boosterService.getById(boosterId), req);
    }

    /** 由需求提交者确认完成；重复确认已关闭订单时返回同一成功结果。 */
    @Transactional
    public ConfirmBoostRequestResponse confirmByRequester(final Long requestId, final String requesterUserId) {
        final BoostRequest req = requestService.getByIdForRequesterForUpdate(requestId, requesterUserId);

        final BoostRequestStatus status = BoostRequestStatus.from(req.getStatus());
        if (status == BoostRequestStatus.CLOSED) {
            return confirmationResponse(req);
        }
        if (status != BoostRequestStatus.PENDING_CONFIRM) {
            throw new IllegalArgumentException("REQUEST_STATUS_NOT_CONFIRMABLE");
        }

        return confirmationResponse(finalizeCompletion(req, OffsetDateTime.now(), null));
    }

    /** 管理员关闭待确认或异常订单，作为客户确认链路的人工兜底。 */
    @Transactional
    public BoostRequest confirmByAdmin(final Long requestId, final String adminNote) {
        final BoostRequest req = requestService.getByIdForUpdate(requestId);
        final BoostRequestStatus status = BoostRequestStatus.from(req.getStatus());
        if (status == BoostRequestStatus.CLOSED) {
            return req;
        }
        if (status != BoostRequestStatus.PENDING_CONFIRM && status != BoostRequestStatus.EXCEPTION) {
            throw new IllegalArgumentException("REQUEST_STATUS_NOT_CONFIRMABLE");
        }
        if (adminNote != null) {
            req.setAdminNote(adminNote);
        }
        return finalizeCompletion(req, OffsetDateTime.now(), adminNote);
    }

    /** 查询一批到期订单 ID；逐单完结由独立事务执行。 */
    @Transactional(readOnly = true)
    public List<Long> findDueAutoConfirmRequestIds(final OffsetDateTime now) {
        return requestService.findDueAutoConfirmIds(now, PageRequest.of(0, AUTO_CONFIRM_BATCH_SIZE));
    }

    /** 在独立事务中自动确认单个到期订单，锁定后再次校验状态和截止时间。 */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean autoConfirmExpiredRequest(final Long requestId, final OffsetDateTime now) {
        final BoostRequest req = requestService.getByIdForUpdate(requestId);
        if (BoostRequestStatus.from(req.getStatus()) != BoostRequestStatus.PENDING_CONFIRM
                || req.getAutoConfirmAt() == null
                || req.getAutoConfirmAt().isAfter(now)) {
            return false;
        }
        finalizeCompletion(req, now, null);
        return true;
    }

    @Transactional
    public BoostAssignmentDto declineByBooster(final Long assignmentId, final Long boosterId, final String note) {
        final LockedAssignment locked = lockActiveAssignmentForBooster(assignmentId, boosterId);
        final BoostRequestAssignment assignment = locked.assignment();
        final BoostRequest req = locked.request();
        requireAssignmentStatus(assignment, BoostAssignmentStatus.ASSIGNED);
        requireRequestStatus(req, BoostRequestStatus.MATCHED);
        final OffsetDateTime now = OffsetDateTime.now();
        assignment.setStatus(BoostAssignmentStatus.DECLINED.name());
        assignment.setUnassignedAt(now);
        assignment.setNote(note);
        assignment.setUpdatedAt(now);
        req.setStatus(BoostRequestStatus.REVIEWING.name());
        req.setCompletionSubmittedAt(null);
        req.setAutoConfirmAt(null);
        req.setUpdatedAt(now);
        notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_DECLINED, assignment);
        return mapper.toDto(assignment, boosterService.getById(boosterId), req);
    }

    @Transactional
    public BoostAssignmentDto unassign(final Long requestId, final String note) {
        final BoostRequest req = requestService.getByIdForUpdate(requestId);
        final BoostRequestAssignment assignment = assignmentRepository
                .findActiveByRequestIdForUpdate(requestId)
                .orElseThrow(() -> new IllegalStateException("NO_ACTIVE_ASSIGNMENT"));
        requireMatchingAssignmentStatus(BoostRequestStatus.from(req.getStatus()), assignment);

        final OffsetDateTime now = OffsetDateTime.now();
        assignment.setUnassignedAt(now);
        assignment.setStatus(BoostAssignmentStatus.CANCELLED.name());
        assignment.setNote(note);
        assignment.setUpdatedAt(now);

        req.setStatus(BoostRequestStatus.REVIEWING.name());
        req.setCompletionSubmittedAt(null);
        req.setAutoConfirmAt(null);
        req.setUpdatedAt(now);

        final BoosterProfile booster = boosterService.getById(assignment.getBoosterId());
        notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_CANCELLED, assignment);
        notifyBooster(booster, UserNotificationType.BOOST_ASSIGNMENT_CANCELLED, req, assignment);
        return mapper.toDto(assignment, booster, req);
    }

    @Transactional
    public void syncActiveAssignmentForRequestStatus(final BoostRequest req,
                                                     final BoostRequestStatus previousStatus,
                                                     final BoostRequestStatus requestStatus,
                                                     final String note) {
        final Optional<BoostRequestAssignment> active = assignmentRepository.findActiveByRequestIdForUpdate(req.getId());
        if (requestStatus == BoostRequestStatus.REJECTED) {
            notifyRequester(req, UserNotificationType.BOOST_REQUEST_REJECTED, null);
        }
        if (active.isEmpty()) {
            if (hasActiveAssignmentState(previousStatus)) {
                throw new IllegalStateException("NO_ACTIVE_ASSIGNMENT");
            }
            return;
        }

        final BoostRequestAssignment assignment = active.get();
        requireMatchingAssignmentStatus(previousStatus, assignment);
        final BoosterProfile booster = boosterService.getById(assignment.getBoosterId());
        final OffsetDateTime now = OffsetDateTime.now();
        if (requestStatus == BoostRequestStatus.EXCEPTION) {
            assignment.setStatus(BoostAssignmentStatus.EXCEPTION.name());
            notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_EXCEPTION, assignment);
            notifyBooster(booster, UserNotificationType.BOOST_ASSIGNMENT_EXCEPTION, req, assignment);
        } else if (requestStatus == BoostRequestStatus.CANCELLED) {
            assignment.setStatus(BoostAssignmentStatus.CANCELLED.name());
            assignment.setUnassignedAt(now);
            notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_CANCELLED, assignment);
            notifyBooster(booster, UserNotificationType.BOOST_ASSIGNMENT_CANCELLED, req, assignment);
        }
        if (StringUtils.hasText(note)) {
            assignment.setNote(note);
        }
        assignment.setUpdatedAt(now);
    }

    private BoostRequest finalizeCompletion(final BoostRequest req,
                                            final OffsetDateTime now,
                                            final String note) {
        final BoostRequestAssignment assignment = assignmentRepository
                .findActiveByRequestIdForUpdate(req.getId())
                .orElseThrow(() -> new IllegalStateException("NO_ACTIVE_ASSIGNMENT"));
        final BoostRequestStatus requestStatus = BoostRequestStatus.from(req.getStatus());
        if (requestStatus != BoostRequestStatus.PENDING_CONFIRM && requestStatus != BoostRequestStatus.EXCEPTION) {
            throw new IllegalArgumentException("REQUEST_STATUS_NOT_CONFIRMABLE");
        }
        requireMatchingAssignmentStatus(requestStatus, assignment);

        assignment.setStatus(BoostAssignmentStatus.COMPLETED.name());
        assignment.setUnassignedAt(now);
        assignment.setUpdatedAt(now);
        if (StringUtils.hasText(note)) {
            assignment.setNote(note);
        }
        req.setStatus(BoostRequestStatus.CLOSED.name());
        req.setUpdatedAt(now);

        final BoosterProfile booster = boosterService.getById(assignment.getBoosterId());
        notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_COMPLETED, assignment);
        notifyBooster(booster, UserNotificationType.BOOST_ASSIGNMENT_COMPLETED, req, assignment);
        return req;
    }

    private static ConfirmBoostRequestResponse confirmationResponse(final BoostRequest req) {
        return new ConfirmBoostRequestResponse(
                req.getId(),
                req.getStatus(),
                "BOOST_REQUEST_COMPLETED",
                req.getUpdatedAt()
        );
    }

    private LockedAssignment lockActiveAssignmentForBooster(final Long assignmentId, final Long boosterId) {
        final BoostRequestAssignment preview = assignmentRepository
                .findByIdAndBoosterIdAndUnassignedAtIsNull(assignmentId, boosterId)
                .orElseThrow(() -> new IllegalArgumentException("ASSIGNMENT_NOT_FOUND"));
        final BoostRequest req = requestService.getByIdForUpdate(preview.getRequestId());
        final BoostRequestAssignment assignment = assignmentRepository
                .findActiveByIdAndBoosterIdForUpdate(assignmentId, boosterId)
                .orElseThrow(() -> new IllegalArgumentException("ASSIGNMENT_NOT_FOUND"));
        return new LockedAssignment(req, assignment);
    }

    private static void requireAssignmentStatus(final BoostRequestAssignment assignment,
                                                final BoostAssignmentStatus expected) {
        final BoostAssignmentStatus actual = BoostAssignmentStatus.from(assignment.getStatus());
        if (actual != expected) {
            throw new IllegalArgumentException("ASSIGNMENT_STATUS_INVALID");
        }
    }

    private static void requireRequestStatus(final BoostRequest req, final BoostRequestStatus expected) {
        final BoostRequestStatus actual = BoostRequestStatus.from(req.getStatus());
        if (actual != expected) {
            throw new IllegalArgumentException("REQUEST_STATUS_INVALID");
        }
    }

    private static void requireMatchingAssignmentStatus(final BoostRequestStatus requestStatus,
                                                        final BoostRequestAssignment assignment) {
        final BoostAssignmentStatus expected = switch (requestStatus) {
            case MATCHED -> BoostAssignmentStatus.ASSIGNED;
            case ACCEPTED -> BoostAssignmentStatus.ACCEPTED;
            case IN_PROGRESS -> BoostAssignmentStatus.IN_PROGRESS;
            case PENDING_CONFIRM -> BoostAssignmentStatus.PENDING_CONFIRM;
            case EXCEPTION -> BoostAssignmentStatus.EXCEPTION;
            default -> null;
        };
        if (expected == null || BoostAssignmentStatus.from(assignment.getStatus()) != expected) {
            throw new IllegalStateException("REQUEST_ASSIGNMENT_STATE_MISMATCH");
        }
    }

    private static boolean hasActiveAssignmentState(final BoostRequestStatus status) {
        return status == BoostRequestStatus.MATCHED
                || status == BoostRequestStatus.ACCEPTED
                || status == BoostRequestStatus.IN_PROGRESS
                || status == BoostRequestStatus.PENDING_CONFIRM
                || status == BoostRequestStatus.EXCEPTION;
    }

    private record LockedAssignment(BoostRequest request, BoostRequestAssignment assignment) {}

    private void notifyRequester(final BoostRequest req,
                                 final UserNotificationType type,
                                 final BoostRequestAssignment assignment) {
        notificationService.create(req.getRequesterUserId(), type, SUBJECT_TYPE, req.getId(), payload(req, assignment));
    }

    private void notifyBooster(final BoosterProfile booster,
                               final UserNotificationType type,
                               final BoostRequest req,
                               final BoostRequestAssignment assignment) {
        notificationService.create(booster.getKeycloakUserId(), type, SUBJECT_TYPE, req.getId(), payload(req, assignment));
    }

    private static Map<String, String> payload(final BoostRequest req, final BoostRequestAssignment assignment) {
        final Map<String, String> payload = new LinkedHashMap<>();
        payload.put("requestId", String.valueOf(req.getId()));
        payload.put("status", req.getStatus());
        if (assignment != null) {
            payload.put("assignmentId", String.valueOf(assignment.getId()));
            payload.put("assignmentStatus", assignment.getStatus());
        }
        if (StringUtils.hasText(req.getRequestType())) {
            payload.put("requestType", req.getRequestType());
        }
        if (StringUtils.hasText(req.getPlayerNickname())) {
            payload.put("playerNickname", req.getPlayerNickname());
        }
        return payload;
    }
}
