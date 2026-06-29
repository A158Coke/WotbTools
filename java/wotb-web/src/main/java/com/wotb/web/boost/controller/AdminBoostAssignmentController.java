package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.AssignBoosterRequest;
import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.dto.UnassignBoosterRequest;
import com.wotb.web.boost.service.BoostAssignmentService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/** 管理员侧分配接口。 */
@RestController
@RequestMapping("/api/admin/boost/requests/{id}/assignments")
@CrossOrigin(origins = "*")
public class AdminBoostAssignmentController {

    private final BoostAssignmentService assignmentService;

    public AdminBoostAssignmentController(final BoostAssignmentService assignmentService) {
        this.assignmentService = assignmentService;
    }

    /** 分配打手（含状态更新，同一事务）。 */
    @PostMapping
    public BoostAssignmentDto assign(@PathVariable final Long id,
                                     @RequestBody final AssignBoosterRequest body) {
        try {
            return assignmentService.assign(id, body.boosterId(), body.note());
        } catch (final DataIntegrityViolationException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "ACTIVE_ASSIGNMENT_EXISTS");
        } catch (final IllegalArgumentException | IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    /** 取消当前分配（含状态回退，同一事务）。 */
    @PatchMapping("/current/unassign")
    public Map<String, Object> unassign(@PathVariable final Long id,
                                        @RequestBody final UnassignBoosterRequest body) {
        try {
            final BoostAssignmentDto dto = assignmentService.unassign(id, body.note());
            return Map.of(
                    "id", dto.id(),
                    "requestId", dto.requestId(),
                    "status", dto.status(),
                    "statusLabel", dto.statusLabel(),
                    "unassignedAt", dto.unassignedAt(),
                    "message", "当前分配已取消。"
            );
        } catch (final IllegalArgumentException | IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }
}
