# Sponsor 运行时内容（收款码 + 配置）

> 何时查阅：更新/轮换赞助收款码、关闭赞助入口，或排查「赞助页显示暂未配置」时。

## 形态与两个发布面

| 项 | 值 |
|---|---|
| 内容 | `sponsor-config.json`（`enabled` + `methods[{type,image}]`；**形状 SSOT = `frontend/src/utils/sponsor-config.js`**）+ `sponsor-assets/<name>.{png,jpg,jpeg,webp}` |
| 存放 | **不在 Git 历史里**：内容作为 GitHub Release 资产发布（`sponsor-runtime-content-v1`），由仓内 pin `deploy/sponsor/content.json` 钉住 `release/asset/sha256`（与 Agent WASM 的 `deploy/agent/source.json` 同一模式）。构建期下载校验后由 `scripts/ci/inject-sponsor-runtime-content.sh` 注入 publicDir（`common/assets/`），Vite 原样拷进 `dist` / `dist-android` |
| Web 面 | Frontend 镜像内 `/usr/share/nginx/html/sponsor-config.json` 与 `/sponsor-assets/*`，与 SPA **同源**伺服（无跨域、不依赖桶 CORS） |
| APK 面 | `assets/web/sponsor-config.json` + `assets/web/sponsor-assets/*`，由本机 origin（`appassets.androidplatform.net`）同源伺服 ⇒ **离线也能显示** |
| TX 侧 | 不挂载、不同步、不下发赞助内容（2026-10-09 前的 host 只读挂载已退场） |

> 为什么不用 Actions secrets 装图片：GitHub 对 secret 值有 48KB 上限，base64 后的收款码超过它。
> Release 资产没有这个限制，且 sha256 就是内容身份，天然可审计。

## 更新 / 轮换收款码

```bash
# 本地目录：sponsor-config.json + sponsor-assets/<name>（内容由维护者持有，不进仓库）
# 1) 自测注入（写入 common/assets/，被 .gitignore 忽略；不碰任何跟踪文件）
SPONSOR_SOURCE_DIR=<本地目录> bash scripts/ci/inject-sponsor-runtime-content.sh
# 2) 打确定性包（排序 + 固定 mtime/owner ⇒ 同内容同字节）
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -cf - \
  -C <本地目录> sponsor-config.json sponsor-assets | gzip -n > sponsor-runtime-content.tar.gz
sha256sum sponsor-runtime-content.tar.gz
# 3) 传为新资产（新 tag 或新 asset 名；不要覆盖旧资产——sha 是身份）
gh release create sponsor-runtime-content-v2 --repo A158Coke/WotbTools \
  --title "Sponsor runtime content v2" --notes "<date/说明>" sponsor-runtime-content.tar.gz
# 4) 更新仓内 pin（release/asset/sha256）并提交；随后 Frontend workflow（Web 面）
#    与下一次 Android 发布（APK 面）各自带上新内容
```

关闭赞助入口：把 pin 指向一份 `{"enabled": false, "methods": []}` 的配置包 —— 只注入配置本身，图片不进发布面，页面按设计回落「暂未配置」。彻底移除：删掉 pin 文件（构建转为「无赞助内容」，页面同样回落）。

## 不变量（全链 fail closed）

- **下载期**：pin 的 `release/asset/sha256` 必须与下载到的资产逐字节一致（`sha256sum -c`）；pin 字段不完整即失败。
- **注入期**（`scripts/ci/inject-sponsor-runtime-content.sh`）：tar 只接受 `sponsor-config.json` 与 `sponsor-assets/` 下的普通文件/目录（拒绝符号链接、绝对路径、`..` 逃逸）；JSON 形状与前端 `normalizeSponsorConfig` 一致；`image` 只能是 `/sponsor-assets/<安全文件名>`；每个 method 的图片存在且是真实图片（magic bytes）。
- **镜像身份含内容指纹**：`deploy/tx/build-frontend-from-gitee.sh` 把 pin 的 sha256 纳入 immutable tag ⇒ 换码必然新 tag/重建，不会被 tag 复用悄悄吞掉；内容未变则照常复用（可复现）。
- **构建后校验**：镜像内 `sponsor-config.json` / `sponsor-assets/*` 必须与 staged 包逐文件 sha256 一致；未注入的构建里**不得**出现它们（防陈旧注入物随复用 tag 混入）。
- **APK 校验**：pin 存在时 release APK 必须带 `assets/web/sponsor-config.json` 与 `assets/web/sponsor-assets/*`（`android-release.yml`）。
- **页面降级**：加载失败的方式逐个隐藏；全部不可用回落「暂未配置」，绝不显示 broken image。

## 回滚

- 收回二维码：删掉 pin（或指向 disabled 配置）后重建 ⇒ 两个发布面都不含二维码（页面「暂未配置」）。
- 回到上一版收款码：pin 改回旧资产的 sha256 与 release/asset 名后重建（旧资产仍在 Releases 里）。
- 单点回滚 Web 面：把 `TX_FRONTEND_IMAGE_REF` 指回上一个 immutable tag（见 `docs/operations/komodo-k7c-frontend-cutover.md` 的发布回退）。
