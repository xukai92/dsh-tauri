# Agent Note: Keep the Tauri application a thin Web shell

Status: implemented

[English](2026-09-15-tauri-thin-web-shell.md) | 中文

## Problem

Tauri 分发需要提供原生 macOS 窗口，同时不能建立另一套后端 composition、RPC 协议、可执行文件闭包或原生 addon 打包路线。应用退出还必须在 Tauri 终止进程前，让 CLI 有机会释放持久终端和已分离的工具进程。

## Decision

`apps/tauri` 是已交付 `dsh web` 应用之上的轻量窗口与进程监督器。它以隔离端口且禁用浏览器打开的方式启动相邻 `dsh-web` 可执行文件，保留完整的认证就绪 URL，并在系统 webview 中加载该 URL。远程模式加载显式 HTTP 或 HTTPS URL而不启动本地 Host。Tauri IPC 不会重复实现 Web Fetch、RPC 或 stream 协议。

`scripts/build-tauri-sidecar.ts` 把可执行文件构建委托给 `scripts/build-exe-for-python-sdk.ts`。适配器把维护中的 runtime 可执行文件、macOS node-pty spawn helper 和 ripgrep companion 复制为 Tauri 所需的带 target 后缀的 `externalBin` 名称。因此 Tauri 路径与 Python runtime 共用闭包、bootstrap、原生资源处理、根目录固定并打补丁的 `@yao-pkg/pkg` 以及打包后的 ripgrep 选择。它不拥有仅供依赖使用的闭包或 sharp 资源布局。

Rust 监督器创建一个进程组，转发 `SIGTERM`，等待六秒让 CLI 完成有界释放，然后在该组仍然存在时终止它。CLI 的正常释放负责已分离子进程组和 PTY session；升级终止只保证监督器拥有的进程组。`RunEvent::Exit` 会显式移除托管的 Host 状态，因为 Tauri 可能在 run callback 后终止进程而不保证销毁 Rust 托管状态。

桌面 release 版本以 Tauri 配置中的字面量版本为准，并与 Cargo 一致。私有 npm manifest 是必需的 workspace 工具元数据，可以随仓库级私有 workspace 版本更新。只有 `tauri-v<version>` 标识该应用的 release workflow。

现有 Electron Desktop 决策仍然是上游无端口、支持插件管理且经过公证的分发方案之权威。这个 fork 专用 Tauri carrier 是更小的替代方案，不取代这些记录。

## Verification

Linux 直接用 `rustc` 运行监督器测试，覆盖正常进程组关闭、leader 退出和有界升级终止。源码驱动器在隔离的 Harness、Agent、凭据和 workspace 状态以及无密钥本地 Messages provider 上启动真实 CLI。它要求认证 HTTP/RPC、设置持久化、带标准化 WebP 元数据的完整图像轮次、持久 PTY 输出、关闭前仍存活的后台后代以及真实 ripgrep 匹配。

macOS workflow 通过已签名 `.app` 的资源重复这些观察，盘点主可执行文件和两个原生 companion，并验证代码签名。它还启动真实应用，观察其返回未认证状态的回环监听器，请求正常应用 Quit，并要求应用和 Host 子进程都退出。

## Alternatives considered

**维护 Tauri 专用可执行文件闭包。** 第二份依赖 manifest、bootstrap、pkg 调用、sharp 库提取和原生路径 resolver 会重复维护中的 Python runtime 路径，并在 runtime 变化时发生漂移。适配器直接复用其产物。

**把 Rust `Drop` 当作应用退出所有权。** Tauri 的 run 生命周期可能终止进程而不销毁托管状态。显式 exit-event teardown 会在应用代码仍运行时给予 CLI 释放窗口。

**只终止 Host leader。** 持久终端和工具进程可能比 leader 存活更久。正常 CLI 释放发生在进程组升级终止之前，测试也区分拥有的进程组与任意已分离后代。

## Consequences

Tauri 应用在源码层保持精简，并跟随单一打包 runtime 实现。其回环传输保留 Web 应用的认证和安全行为，代价是会打开本地监听器，而不是使用 Electron Desktop 的无端口 carrier。原生 release 资格验证仍仅限 macOS，并要求已签名 bundle 冒烟；Linux 只证明源码/runtime 协议行为与监督器所有权。
