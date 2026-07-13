package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.BoostRequestDto;
import com.wotb.web.boost.dto.CreateBoostRequestRequest;
import com.wotb.web.boost.dto.CreateBoostRequestResponse;
import com.wotb.web.boost.service.BoostRequestService;
import com.wotb.web.util.JwtUtil;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

/** 玩家侧需求接口 — 需登录。 */
@RestController
@RequestMapping("/api/boost/requests")
@CrossOrigin(origins = "*")
public class BoostRequestController {

    private final BoostRequestService service;

    public BoostRequestController(final BoostRequestService service) {
        this.service = service;
    }

    @PostMapping
    public CreateBoostRequestResponse create(@RequestBody final CreateBoostRequestRequest body) {
        final String userId = JwtUtil.requireUserId();
        return service.create(
                userId, body.region(), body.requestType(),
                body.targetDescription(), body.contactType(), body.contactValue(),
                body.playerAccountId(), body.playerNickname(),
                body.budgetRange(), body.availableTime(), body.remark()
        );
    }

    @GetMapping("/my")
    public List<BoostRequestDto> listMy() {
        return service.listMy(JwtUtil.requireUserId());
    }

    @GetMapping("/my/{id}")
    public BoostRequestDto getMy(@PathVariable final Long id) {
        return service.getMy(id, JwtUtil.requireUserId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "REQUEST_NOT_FOUND"));
    }

    @PatchMapping("/my/{id}/cancel")
    public Map<String, Object> cancel(@PathVariable final Long id) {
        final String userId = JwtUtil.requireUserId();
        final BoostRequestDto dto = service.cancel(id, userId);
        return Map.of(
                "id", dto.id(),
                "status", dto.status(),
                "code", "BOOST_REQUEST_CANCELLED"
        );
    }
}
