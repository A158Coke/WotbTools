# Android 自动发布补充契约

本文件补充 `release-process.md` 的两阶段实现，并覆盖其中“stage 后必须等待人工真机验收再手工 publish”的操作约定。

## 正常路径

Android 仍保留 `stage -> publish` 两个技术阶段，但不再把两者之间的人工确认作为质量门禁：

1. `android/gradle.properties` 的版本变更合入 `main` 后，`Release / Android` 自动执行 `stage`。
2. `stage` 继续负责 contract/cutover guard、frontend 测试与构建、APK 构建/签名、证书校验、SHA-256、清华副本、TX1/TX2 immutable seed、tag、staging evidence 与公网回读。
3. 当该 `main` push 的 `Release / Android` run 成功，`Android Auto Publish` 自动读取这次 staged source 的 `wotbVersion`，并 dispatch 现有 `Release / Android`：`mode=publish, version=X`。
4. 现有 `publish` job 原样承担 immutable tag / staging evidence / APK identity、minSupported/cutover、Keycloak、API/CORS、asset readiness 等 guard；只有这些检查全部通过后才写 production `version.json`。

因此正常发布语义是：

```text
merge Android version bump
  -> stage technical validation
  -> stage green
  -> automatic guarded publish
  -> production version.json readback
```

`stage` 成功表示该候选具备自动进入 publish 的资格，不再表示“等待人工批准”。

## 手动入口

`workflow_dispatch(mode=publish, version=X)` 保留，但定位改为恢复/重跑入口，例如：

- 自动 dispatch 失败；
- publish 因瞬时网络、TX 上传或 production readback 失败；
- 已 staged candidate 需要按原 immutable identity 幂等续跑。

手动入口不能绕过现有 publish guards，也不能重建或 repoint 已 staged candidate。

## 真机测试

真机测试仍然有价值，但不再是 production `version.json` 写入之前的强制人工 gate。当前实际操作是发布后做 production smoke / regression；发现问题时按正常版本规则修复并发布更高版本，而不是把未执行的真机检查伪装成 stage/publish 之间的审批。
