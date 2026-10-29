# Android 自动发布补充契约

本文件补充 `release-process.md` 的两阶段实现，并覆盖其中“stage 后必须等待人工真机验收再手工 publish”的操作约定。

## 正常路径

Android 仍保留 `stage -> publish` 两个技术阶段，但不再把两者之间的人工确认作为质量门禁：

1. `android/gradle.properties` 的版本变更合入 `main` 后，`Release / Android` 自动执行 `stage`。
2. `stage` 继续负责 contract/cutover guard、frontend 测试与构建、APK 构建/签名、证书校验、SHA-256、清华副本、TX1/TX2 immutable seed、tag、staging evidence 与公网回读。
3. 当该 `main` push 的 `Release / Android` run 成功，`Android Auto Publish` 自动读取这次 staged source 的 `wotbVersion`。
4. 自动续跑采用 **latest-main-wins**：dispatch 前重新读取 `refs/heads/main`；只有 staged source 仍等于当前 main 才自动 dispatch `Release / Android(mode=publish, version=X)`。若 main 已前进到更新候选，旧 staged 版本跳过自动发布，避免旧 publish 抢占/替换较新的 pending stage。
5. 现有 `publish` job 原样承担 immutable tag / staging evidence / APK identity、minSupported/cutover、Keycloak、API/CORS、asset readiness 等 guard；只有这些检查全部通过后才写 production `version.json`。

因此正常发布语义是：

```text
merge Android version bump
  -> stage technical validation
  -> stage green
  -> still latest main?
       yes -> automatic guarded publish -> production version.json readback
       no  -> skip stale auto-publish; newer main candidate owns CD
```

`stage` 成功表示该候选具备进入 publish 的技术资格，不再表示“等待人工批准”；自动路径还要求该候选在 dispatch 瞬间仍是最新 main。

多个 `Android Auto Publish` 续跑判断使用独立 `android-auto-publish` concurrency queue 串行处理（`queue: max`）。它只串行 freshness decision，不替代 `Release / Android` 自己的生产互斥。这样旧候选不会因为晚到的自动 dispatch 把更新候选从 release concurrency 的 pending 槽中挤掉。

## 手动入口

`workflow_dispatch(mode=publish, version=X)` 保留，但定位改为恢复/重跑入口，例如：

- 自动 dispatch 失败；
- publish 因瞬时网络、TX 上传或 production readback 失败；
- 已 staged candidate 需要按原 immutable identity 幂等续跑；
- 操作者明确需要发布一个已被更新 main 取代、因此自动路径主动跳过的历史 staged candidate。

手动入口不能绕过现有 publish guards，也不能重建或 repoint 已 staged candidate。

## 真机测试

真机测试仍然有价值，但不再是 production `version.json` 写入之前的强制人工 gate。当前实际操作是发布后做 production smoke / regression；发现问题时按正常版本规则修复并发布更高版本，而不是把未执行的真机检查伪装成 stage/publish 之间的审批。
