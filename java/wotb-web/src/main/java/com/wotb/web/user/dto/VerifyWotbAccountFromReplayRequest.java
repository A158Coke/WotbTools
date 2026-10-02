package com.wotb.web.user.dto;

/**
 * 用回放验证绑定账号：客户端本地解析（上游 Rust Core）得到的录像者数值 accountId。
 */
public record VerifyWotbAccountFromReplayRequest(Long recorderAccountId) {}
