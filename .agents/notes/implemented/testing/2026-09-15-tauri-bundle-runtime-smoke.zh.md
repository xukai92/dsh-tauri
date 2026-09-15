# Agent Note: 发布前测试 macOS bundle 运行时

Status: implemented

[English](2026-09-15-tauri-bundle-runtime-smoke.md) | 中文

## Problem

macOS 工作流过去只证明已签名 sidecar 输出了启动行。该检查会接受缺少 node-pty spawn helper 的应用 bundle，也不会加载前端、调用 RPC，或测试图像处理、持久终端、设置持久化、应用退出和后代进程清理。源码测试无法证明原生可执行文件和库位于已签名 `.app` 的预期位置。

桌面监督器还依赖托管状态析构，但 Tauri 退出进程时不保证托管的 Rust 值会被 drop。只终止宿主 leader 可能留下同进程组后代，而在 CLI 完成关闭前终止宿主进程组可能中断已分离子进程组和 PTY session 的清理。

## Decision

macOS 工作流先验证完整应用签名，然后对已构建 `.app` 运行 `scripts/smoke-tauri-bundle.ts`。冒烟测试要求 `dsh-web`、`dsh-web-spawn-helper` 和有内容的 `sharp-libs` 资源位于发行位置。它使用隔离的 `DSH_HOME`、清理过的环境和无密钥本地模型服务来启动已签名 sidecar；加载实际前端；调用 RPC；持久化一项设置；通过 sharp 归一化发送图像；通过持久 PTY 完成模型 turn；并确认 sidecar 正常关闭会移除仍存活的 PTY 子进程。同一 driver 提供源码模式，使用仅供测试的 preset 来选择可执行的 Bash 路径，因此可以在 Linux 上测试其协议和转义逻辑而不改变产品的 macOS 默认值。

随后，冒烟测试启动 `Contents/MacOS/dsh-tauri`，发现其直接 `dsh-web` 子进程和监听端口，加载该前端，通过 AppleScript 请求标准 macOS 应用 Quit，并要求两个进程都退出。这会执行 Tauri 的 `RunEvent::Exit` 路径，而不是假设 sidecar 测试可以覆盖应用关闭。

监督器在独立进程组中启动本地宿主。应用正常退出时会明确取得托管宿主并向该进程组发送 `SIGTERM`，为 CLI 的五秒 context 释放留出六秒，然后才向仍存在的进程组发送 `SIGKILL`。跨平台独立 Rust 测试覆盖完整就绪 URL 保留、严格回环就绪解析、普通进程组清理，以及 leader 已退出但同组后代忽略 `SIGTERM` 时的升级。创建了自身进程组的子进程和 PTY 仍由 CLI 正常释放负责。

远程浏览器测试通过 Chromium host resolution 使用 `remote.test`。它断言页面处于没有 `crypto.randomUUID` 的不安全 context，调用真实宿主 RPC，确认欢迎设置，重新加载，并观察已持久化的远程设置。其环境无密钥且与环境中的凭据隔离。

## Alternatives considered

**只检查源码字符串或构建输出。** 缺失的 spawn helper 在 bundle 前已经输出，因此构建日志和源码断言都不能代表最终应用清单。清单检查仍有用，但运行时行为才是验收信号。

**为原生库增加产品冒烟命令。** 仅供测试的产品入口会增加一个只用于验证的发行接口。已组装的前端、RPC、模型 replay、图像和 PTY 路径已经暴露所需行为。

**只测试已签名 sidecar。** 这不会执行 Tauri 的退出 callback，因而会漏掉正常 Quit 后桌面托管宿主仍在运行的回归。

**使用 localhost 子域测试远程 HTTP。** 浏览器把 localhost 名称视为可能可信，因此该 origin 无法重现普通不安全远程 HTTP 中缺失 secure-context crypto API 的情况。

**立即终止宿主进程组。** 这会移除同组后代，但可能在 CLI 释放已分离工具组和 PTY session 前中断它。带期限的正常关闭既保留清理所有者，又保留升级截止时间。

## Consequences

macOS 产物无法在缺少原生 helper 时通过工作流，启动成功也无法掩盖 HTTP、RPC、图像、终端、持久化或正常 Quit 行为损坏。Linux 无需安装完整 Tauri/WebKit 开发栈即可运行监督器回归和源码冒烟测试。

实际 bundle 和应用启动仍然是 macOS CI 证据；Linux 可以检查产物清单，但不能执行其中的 Mach-O 文件。强制停止回退只保证清理 sidecar 进程组。如果工具已经分离到另一个进程组后 CLI 正常释放卡住，监督器无法保证移除该任意分离进程。
