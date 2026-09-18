# dsh-tauri

[English](README.md) | 中文

DeepSeek Harness Web GUI 的原生 macOS 桌面 shell。它是现有 web profile 的一层轻量 [Tauri](https://tauri.app) 包装：它启动 `dsh --profile web`，从宿主就绪时输出的信息中发现回环 URL，并在原生系统 webview（macOS 上为 `WKWebView`）中打开该 URL。

整个 GUI 都是 dsh 自身的前端——该 crate 只负责窗口和进程监督。webview 通过普通的同源回环 HTTP/RPC 接口（`/api` fetch envelope 和事件 WebSocket）与宿主通信，与浏览器的方式完全相同，因此 `apps/web` 前端无需更改，也没有用于应用 RPC 的 Tauri IPC bridge。小型连接提示只使用一个 shell 自有的 Tauri command 来导航窗口。

## 工作方式

1. `run()` 以 `--profile web --port 0 --no-open` 启动打包的 `dsh-web` sidecar。`scripts/build-tauri-sidecar.ts` 把维护中的 Python SDK runtime 可执行文件复制为 Tauri `externalBin` 所需的名称；`--port 0` 让操作系统选择空闲端口，因此两个 shell 不会冲突。当相邻的打包 sidecar 不存在时，`DSH_BIN` 会先于 `PATH` fallback 提供开发二进制文件。
2. worker thread 读取宿主的 stdout，直到找到就绪行 `dsh web: http://127.0.0.1:<port>`，然后保留其完整 URL，包括可能存在的认证 query。
3. `WebviewWindowBuilder` 在该外部 URL 上打开内容窗口。切换到其他宿主时，会用新 URL 上的新窗口替换该窗口，而不是在当前页面上导航：当导航源于其他站点时，WebKit 会拒绝宿主 token 重定向期间设置的 `SameSite=Strict` session cookie，因此复用窗口会在完成 token 交换后仍处于未认证状态。
4. 子进程保存在 Tauri 托管状态中。应用正常退出时会明确给予宿主六秒来释放 PTY 和已分离的工具进程，然后终止仍然存在的宿主进程组。

监督器和 URL 解析器（含单元测试）见 `src-tauri/src/dsh.rs`，连线见 `src-tauri/src/lib.rs`。

## 先决条件

- **macOS 13+**（bundle 目前仅支持 macOS；安装相应依赖后，同一份 Rust 也可在 Linux/Windows 上编译）。
- **Rust** 1.77.2+（`rustup`）。
- **Tauri CLI**——可使用 `pnpm`（`@tauri-apps/cli` devDependency）或 `cargo install tauri-cli`。

## 运行（开发）

```sh
# from this directory (apps/tauri)
pnpm install            # in the repo root, once
pnpm tauri dev          # or: cargo tauri dev
```

窗口会在已提供服务的 GUI 上打开。`dsh` 的 stderr 会被继承，因此宿主诊断信息会出现在终端中。开发时不会打包 sidecar，因此使用 `DSH_BIN`（或 `PATH` 上的 `dsh`）。

## 构建 macOS 应用

```sh
pnpm exec tsx scripts/build-tauri-sidecar.ts --targets node24-macos-arm64
pnpm tauri build        # from apps/tauri
```

第一步委托给 `scripts/build-exe-for-python-sdk.ts`，复用根目录中打过补丁的 `@yao-pkg/pkg`、维护中的 runtime 闭包和 bootstrap。适配器把主可执行文件、node-pty spawn helper 和 ripgrep sidecar 复制到 `apps/tauri/binaries/`；然后 `tauri build` 将三者打包。输出为 `src-tauri/target/release/bundle/macos/DeepSeek Harness.app` 和一个 `.dmg`。构建 `.app`/`.dmg` 需要 macOS；在安装 WebKitGTK 4.1 开发包后，Rust 本身的 `cargo check`/`cargo build` 可在 Linux 上工作。

桌面 release 版本以 `src-tauri/tauri.conf.json` 中的字面量 `version` 为准，Cargo 版本必须与其一致。私有 npm manifest 只是 workspace 工具元数据，可以随仓库级版本自动化更新。推送匹配的 `tauri-v<version>` tag 会运行 macOS 工作流并创建包含 DMG 的 GitHub Release；预发布版本会创建 GitHub 预发布。分支、Pull Request 和未标记 tag 的手动运行只保留七天期的 Actions 产物。

## 从源码验证

监督器测试只需要 `rustc`；冒烟命令会使用隔离的 home、本地模型服务和仅供测试的 Bash 路径启动真实源码 CLI。

```sh
rustc --edition=2021 --test apps/tauri/src-tauri/tests/supervisor.rs -o /tmp/dsh-supervisor-test
/tmp/dsh-supervisor-test
node --import tsx/esm scripts/smoke-tauri-bundle.ts --source-cli
```

## 配置

- `DSH_BIN`——应用可执行文件旁没有 `dsh-web` 时要启动的二进制文件（默认 fallback：`PATH` 上的 `dsh`）。
- `DSH_REMOTE_URL=http://host:port/?token=…`——远程模式：加载已在运行的 `dsh --profile web` 宿主，而不是启动本地 sidecar。首次连接必须粘贴输出的完整启动 URL；普通 origin 不含认证 token，会返回 HTTP 401。**Connection ▸ Connect to Remote…** 菜单项以交互方式完成同一操作。
- 其他所有项（API key、`DSH_HOME` 等）都是 dsh 自身的配置，并通过继承的环境传入。只有实际运行 agent 时才需要 `DEEPSEEK_API_KEY`；没有它也可以打开 GUI。

## 已知限制和后续工作

- **原生附属文件。** sidecar 带有 node-pty 的 `dsh-web-spawn-helper` 和 `dsh-web-rg` ripgrep 二进制文件。macOS 工作流会检查它们在最终 `.app` 中的位置，然后覆盖已签名 sidecar 的认证前端/RPC、图像标准化、持久终端、ripgrep、设置和关闭路径。它也会启动应用并请求正常的 macOS Quit。
- **强制停止范围有限。** 正常关闭让 CLI 释放已分离的子进程组和 PTY session。如果该路径卡住，监督器的强制停止会覆盖 sidecar 自己的进程组；它无法保证清理已分离到其他进程组的任意进程。
- **回环 HTTP，无 IPC bridge。** 我们使用浏览器同样使用的、经过认证的 `http://127.0.0.1:<port>` 传输。shell 不提供第二套 RPC 实现。
- **占位图标。** 由 `apps/web/public/favicon.svg` 生成；发行前需替换为正式品牌图标集。
- **Ad-hoc 签名。** 显式的 `-` 签名身份可防止 Apple Silicon 将下载的应用报告为已损坏。由于嵌入的 Node/V8 sidecar 需要可执行内存，此无密钥构建会禁用 hardened runtime；release 工作流会在发布前验证 bundle 签名并测试已签名的 sidecar 和应用。由于应用尚未公证，首次启动时仍可能需要在**系统设置 ▸ 隐私与安全性**中批准。要实现无警告分发，需要在 CI 中配置 Developer ID Application 证书和 Apple 公证凭据。
