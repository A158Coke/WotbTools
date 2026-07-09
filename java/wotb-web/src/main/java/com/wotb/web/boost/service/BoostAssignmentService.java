package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.enums.BoostAssignmentStatus;
import com.wotb.web.boost.enums.BoostRequestStatus;
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import com.wotb.web.user.enums.UserNotificationType;
import com.wotb.web.user.service.UserNotificationService;
import org.springframework.stereotype.Service;
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

    private final BoostRequestAssignmentRepository assignmentRepository;
    private final BoostRequestService requestService;
    private final BoosterService boosterService;
    private final BoostAssignmentMapper mapper;
    private final UserNotificationService notificationService;

    public BoostAssignmentService(final BoostRequestAssignmentRepository assignmentRepository,
                                  final BoostRequestService requestService,
                                  final BoosterService boosterService,
                                  final BoostAssignmentMapper mapper,
                                  final UserNotificationService notificationService) {
        this.assignmentRepository = assignmentRepository;
        this.requestService = requestService;
        this.boosterService = boosterService;
        this.mapper = mapper;
        this.notificationService = notificationService;
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
        if (assignmentRepository.findByRequestIdAndUnassignedAtIsNull(requestId).isPresent()) {
            throw new IllegalStateException("ACTIVE_ASSIGNMENT_EXISTS");
        }

        final BoostRequest req = requestService.getById(requestId);
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
        req.setUpdatedAt(now);

        notifyBooster(booster, UserNotificationType.BOOST_ASSIGNMENT_RECEIVED, req, assignment);
        notifyRequester(req, UserNotificationType.BOOST_REQUEST_ASSIGNED, assignment);
        return mapper.toDto(assignment, booster, req);
    }

    @Transactional
    public BoostAssignmentDto acceptByBooster(final Long assignmentId, final Long boosterId) {
        final BoostRequestAssignment assignment = activeAssignmentForBooster(assignmentId, boosterId);
        requireAssignmentStatus(assignment, BoostAssignmentStatus.ASSIGNED);
        final BoostRequest req = requestService.getById(assignment.getRequestId());
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
        final BoostRequestAssignment assignment = activeAssignmentForBooster(assignmentId, boosterId);
        requireAssignmentStatus(assignment, BoostAssignmentStatus.ACCEPTED);
        final BoostRequest req = requestService.getById(assignment.getRequestId());
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
        final BoostRequestAssignment assignment = activeAssignmentForBooster(assignmentId, boosterId);
        final BoostAssignmentStatus status = BoostAssignmentStatus.from(assignment.getStatus());
        if (status != BoostAssignmentStatus.ACCEPTED && status != BoostAssignmentStatus.IN_PROGRESS) {
            throw new IllegalArgumentException("ASSIGNMENT_STATUS_NOT_COMPLETABLE");
        }
        final BoostRequest req = requestService.getById(assignment.getRequestId());
        final OffsetDateTime now = OffsetDateTime.now();
        assignment.setStatus(BoostAssignmentStatus.PENDING_CONFIRM.name());
        assignment.setNote(note);
        assignment.setUpdatedAt(now);
        req.setStatus(BoostRequestStatus.PENDING_CONFIRM.name());
        req.setUpdatedAt(now);
        notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_PENDING_CONFIRM, assignment);
        return mapper.toDto(assignment, boosterService.getById(boosterId), req);
    }

    @Transactional
    public BoostAssignmentDto declineByBooster(final Long assignmentId, final Long boosterId, final String note) {
        final BoostRequestAssignment assignment = activeAssignmentForBooster(assignmentId, boosterId);
        requireAssignmentStatus(assignment, BoostAssignmentStatus.ASSIGNED);
        final BoostRequest req = requestService.getById(assignment.getRequestId());
        final OffsetDateTime now = OffsetDateTime.now();
        assignment.setStatus(BoostAssignmentStatus.DECLINED.name());
        assignment.setUnassignedAt(now);
        assignment.setNote(note);
        assignment.setUpdatedAt(now);
        req.setStatus(BoostRequestStatus.REVIEWING.name());
        req.setUpdatedAt(now);
        notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_DECLINED, assignment);
        return mapper.toDto(assignment, boosterService.getById(boosterId), req);
    }

    @Transactional
    public BoostAssignmentDto unassign(final Long requestId, final String note) {
        final BoostRequestAssignment assignment = assignmentRepository
                .findByRequestIdAndUnassignedAtIsNull(requestId)
                .orElseThrow(() -> new IllegalStateException("NO_ACTIVE_ASSIGNMENT"));

        final OffsetDateTime now = OffsetDateTime.now();
        assignment.setUnassignedAt(now);
        assignment.setStatus(BoostAssignmentStatus.CANCELLED.name());
        assignment.setNote(note);
        assignment.setUpdatedAt(now);

        final BoostRequest req = requestService.getById(requestId);
        if (!isTerminal(BoostRequestStatus.from(req.getStatus()))) {
            req.setStatus(BoostRequestStatus.REVIEWING.name());
            req.setUpdatedAt(now);
        }

        final BoosterProfile booster = boosterService.getById(assignment.getBoosterId());
        notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_CANCELLED, assignment);
        notifyBooster(booster, UserNotificationType.BOOST_ASSIGNMENT_CANCELLED, req, assignment);
        return mapper.toDto(assignment, booster, req);
    }

    public void syncActiveAssignmentForRequestStatus(final BoostRequest req,
                                                     final BoostRequestStatus requestStatus,
                                                     final String note) {
        final Optional<BoostRequestAssignment> active = assignmentRepository.findByRequestIdAndUnassignedAtIsNull(req.getId());
        if (requestStatus == BoostRequestStatus.REJECTED) {
            notifyRequester(req, UserNotificationType.BOOST_REQUEST_REJECTED, null);
        }
        if (active.isEmpty()) {
            return;
        }

        final BoostRequestAssignment assignment = active.get();
        final BoosterProfile booster = boosterService.getById(assignment.getBoosterId());
        final OffsetDateTime now = OffsetDateTime.now();
        if (requestStatus == BoostRequestStatus.CLOSED) {
            assignment.setStatus(BoostAssignmentStatus.COMPLETED.name());
            assignment.setUnassignedAt(now);
            notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_COMPLETED, assignment);
            notifyBooster(booster, UserNotificationType.BOOST_ASSIGNMENT_COMPLETED, req, assignment);
        } else if (requestStatus == BoostRequestStatus.EXCEPTION) {
            assignment.setStatus(BoostAssignmentStatus.EXCEPTION.name());
            notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_EXCEPTION, assignment);
            notifyBooster(booster, UserNotificationType.BOOST_ASSIGNMENT_EXCEPTION, req, assignment);
        } else if (requestStatus == BoostRequestStatus.CANCELLED || requestStatus == BoostRequestStatus.REJECTED) {
            assignment.setStatus(BoostAssignmentStatus.CANCELLED.name());
            assignment.setUnassignedAt(now);
            if (requestStatus == BoostRequestStatus.CANCELLED) {
                notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_CANCELLED, assignment);
            }
            notifyBooster(booster, UserNotificationType.BOOST_ASSIGNMENT_CANCELLED, req, assignment);
        } else if (requestStatus == BoostRequestStatus.PENDING_CONFIRM) {
            assignment.setStatus(BoostAssignmentStatus.PENDING_CONFIRM.name());
            notifyRequester(req, UserNotificationType.BOOST_ASSIGNMENT_PENDING_CONFIRM, assignment);
        }
        if (StringUtils.hasText(note)) {
            assignment.setNote(note);
        }
        assignment.setUpdatedAt(now);
    }

    private BoostRequestAssignment activeAssignmentForBooster(final Long assignmentId, final Long boosterId) {
        return assignmentRepository.findByIdAndBoosterIdAndUnassignedAtIsNull(assignmentId, boosterId)
                .orElseThrow(() -> new IllegalArgumentException("ASSIGNMENT_NOT_FOUND"));
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

    private static boolean isTerminal(final BoostRequestStatus status) {
        return status == BoostRequestStatus.CLOSED
                || status == BoostRequestStatus.REJECTED
                || status == BoostRequestStatus.CANCELLED;
    }

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
