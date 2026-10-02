# 个人主页 · WoTB 账号绑定与「用回放验证」

> 实现：`java/wotb-web/.../user/`（`UserProfileService.verifyWotbAccountFromReplay`）、
> `frontend/src/components/ProfilePage.vue`、`frontend/src/replay-local/submissionFacts.ts#replayRecorderAccountId`。
> 绑定 / 解绑 / WG 登录同步的完整规则见 `docs/DEVELOPER_GUIDE.md`「绑定账号的验证状态」。

## 「用回放验证」的信任模型（产品决策，2026-10）

**这是客户端声称的便利徽章，不是身份证明。**

1. 浏览器本地用锁定版本的上游 Agent WASM（`parseResult`）解析用户选中的回放；
2. 本地得到录像者的数值 accountId；
3. 客户端只 POST 这个 accountId（`POST /api/users/wotb-account/verify-replay`，body `{recorderAccountId}`）——
   **不上传回放、服务端不解析回放、不比对回放字节**（server has no replay parser）；
4. 服务端只比较「客户端声称的录像者 accountId」与当前绑定的 WoTB accountId；
5. 相等 → 设置 `wotb_account_verified_at`（首次时间，幂等），个人主页显示已验证徽章。

徽章：

- **不授予任何权限、不参与任何授权判定、不是身份安全边界**；
- 客户端数据可以伪造（直接 POST 任意 accountId），这是**明确接受**的风险——功能本身不重要，不值得为它建立
  回放验真、密码学证明或抽样解析；
- 解绑 / 切换绑定账号会清空验证时间（陈旧验证不得被继承）。

守卫：`ReplayVerificationBadgeBoundaryTest`（`wotbAccountVerifiedAt` 只允许出现在 user 域的实体 / DTO / Mapper /
Service，任何授权代码读取它都会失败）、`UserProfileServiceTest#verificationIsAClientAssertedComparisonNotAReplayAuthenticityCheck`。
想让徽章影响权限，必须先推翻本决策并重新设计验真机制——而服务器没有 parser。
