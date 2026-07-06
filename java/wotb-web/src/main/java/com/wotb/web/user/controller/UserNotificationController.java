package com.wotb.web.user.controller;

import com.wotb.web.user.dto.UnreadNotificationCountDto;
import com.wotb.web.user.dto.UserNotificationDto;
import com.wotb.web.user.service.UserNotificationService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/users/notifications")
@CrossOrigin(origins = "*")
public class UserNotificationController {

    private final UserNotificationService service;

    public UserNotificationController(final UserNotificationService service) {
        this.service = service;
    }

    @GetMapping
    public List<UserNotificationDto> list() {
        return service.listMine(JwtUtil.requireUserId());
    }

    @GetMapping("/unread-count")
    public UnreadNotificationCountDto unreadCount() {
        return new UnreadNotificationCountDto(service.unreadCount(JwtUtil.requireUserId()));
    }

    @PatchMapping("/{id}/read")
    public UserNotificationDto markRead(@PathVariable final Long id) {
        return service.markRead(JwtUtil.requireUserId(), id);
    }

    @PatchMapping("/read-all")
    public Map<String, String> markAllRead() {
        service.markAllRead(JwtUtil.requireUserId());
        return Map.of("message", "NOTIFICATIONS_MARKED_READ");
    }
}
