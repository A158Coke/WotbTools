package com.wotb.web.admin;

import com.wotb.web.admin.dto.AdminDeleteUserResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 管理员 API 异常处理。 */
@RestControllerAdvice(basePackageClasses = AdminUserController.class)
public class AdminApiExceptionHandler {

    @ExceptionHandler(AdminBadRequestException.class)
    public ResponseEntity<AdminDeleteUserResponse> handleBadRequest(final AdminBadRequestException e) {
        final AdminDeleteUserResponse body = new AdminDeleteUserResponse(
                false, null, false, false, e.getErrorCode(), e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    @ExceptionHandler(AdminConflictException.class)
    public ResponseEntity<AdminDeleteUserResponse> handleConflict(final AdminConflictException e) {
        final AdminDeleteUserResponse body = new AdminDeleteUserResponse(
                false, null, false, false, e.getErrorCode(), e.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }

    @ExceptionHandler(AdminInternalException.class)
    public ResponseEntity<AdminDeleteUserResponse> handleInternal(final AdminInternalException e) {
        final AdminDeleteUserResponse body = new AdminDeleteUserResponse(
                false, null, false, false, e.getErrorCode(), e.getMessage());
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body);
    }
}
