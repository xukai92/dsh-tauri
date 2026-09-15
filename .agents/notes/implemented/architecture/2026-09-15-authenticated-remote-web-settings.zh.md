# Agent Note: 经认证的远程 Web 设置

Status: implemented

[English](2026-09-15-authenticated-remote-web-settings.md) | 中文

## 问题

Web 应用已经认证每个 Host API 请求并围住每个服务 authority，但随附 CLI 拒绝其既有的全接口绑定模式。单独组合的远程 Host 可以提供该应用，但 Client 仅因页面 authority 不是 loopback 就禁用 settings API。因此，经认证的远程用户能够运行具备工具能力的 Session，却无法保留普通偏好，也无法让欢迎声明的确认在刷新后继续生效。

## 决策

`dsh web --host 0.0.0.0` 启用 webserver 既有的全接口绑定。Web runtime 把非内部 IPv4 地址采样为可信、无端口的 LAN authority，并且只通过可重复的 `--trusted-host` 接受额外具名 authority。每个 API 请求仍先经过 Host/Origin/Fetch-Metadata 围栏，再经过既有安全决策持有的进程令牌 cookie 认证。服务器仍提供纯 HTTP，也不解释任何转发 header。

Web Client 对每个经认证的服务 authority 使用 Host 设置持久化。此变更只改变偏好与引导流程的持久化；`ctx.connection.isLoopback` 继续守卫要求操作者坐在 Host 前的桌面原生操作。可信 authority 绝不改变该事实，也不会把远程页面变成本地页面。

## 验证

命令行提供方测试接受显式全接口值，同时保留无效端口拒绝。远程浏览器场景只在 Chromium 内把 `remote.test` 映射到 loopback，以 `Host: remote.test:<port>` 对真实 loopback socket 执行进程令牌交换，并通过该 authority 运行组装后的 Web 应用。场景断言浏览器上下文不安全且没有 `crypto.randomUUID`，调用真实的经认证 settings RPC，在隔离的 Host 文档中观察欢迎确认，刷新并等到 Settings 外壳结算，再观察声明保持关闭。既有 Connection 套件继续覆盖伪造 Host、跨源、未认证、绑定 authority 的 cookie，以及 cookie 跨重启复用。

## 考虑过的替代方案

**把可信 authority 当作 loopback。** 否决，因为这还会启用桌面原生操作以及未来任何仅限本地的行为。服务 authority 信任与操作者是否在 Host 前仍是两个独立事实。

**把远程设置留在浏览器内存中。** 否决，因为认证已经授权完整的工具型 Host API。只禁用偏好持久化并未增加安全边界，反而造成刷新前后行为不一致。

**加入 TLS 或反向代理转发 header 支持。** 否决，因为随附服务器没有证书或代理配置的持有者。把服务器暴露到可信网络之外的部署必须在 Harness 外部提供传输保护，且不得让转发 header 在 Harness 内成为权威。

## 后果

操作者可以有意在 LAN 或具名 authority 上提供 Web 应用，而无需自定义组合；经认证的 Client 共享 Host 的持久设置文档。纯 HTTP 会向网络暴露启动 URL 与会话 cookie，因此只有当操作者接受该传输风险或在 Harness 外部提供保护时才适合使用此模式。浏览器信任与令牌认证说明仍保持 active，因为其独立安全规则继续治理每个请求；没有既有 Agent Note 被完全取代或归档。
