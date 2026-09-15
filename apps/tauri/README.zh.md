# dsh-tauri

[English](README.md) | 中文

DeepSeek Harness Web GUI 的原生 macOS 桌面 shell。它是现有 web profile 的一层轻量 [Tauri](https://tauri.app) 包装：它启动 `dsh --profile web`，从宿主就绪时输出的信息中发现回环 URL，并在原生系统 webview（macOS 上为 `WKWebView`）中打开该 URL。

整个 GUI 都是 dsh 自身的前端——该 crate 只负责窗口和进程监督。webview 通过普通的同源回环 HTTP/RPC 接口（`/api` fetch envelope 和事件 WebSocket）与宿主通信，与浏览器的方式完全相同，因此 `apps/web` 前端无需更改，也没有 Tauri IPC bridge。

## 工作方式

1. `run()` 以 `--profile web --port 0` 启动打包的 `dsh-web` sidecar：该单文件 exe 由 `scripts/build-tauri-sidecar.ts` 构建（在 web profile 闭包上使用 `@yao-pkg/pkg --sea`），并通过 Tauri `externalBin` 嵌入；`--port 0` 让操作系统选择空闲端口，因此两个 shell 永远不会冲突。`DSH_BIN` 会覆盖用于开发的二进制文件。
2. worker thread 读取宿主的 stdout，直到找到就绪行 `dsh web: http://127.0.0.1:<port>`，然后解析端口。
3. `WebviewWindowBuilder` 在该外部 URL 上打开窗口 `main`。
4. 子进程保存在 Tauri 托管状态中，并在 drop 时被终止，因此退出 shell 也会关闭宿主。

shell 还把 `DYLD_LIBRARY_PATH`/`LD_LIBRARY_PATH` 设为打包的 `sharp-libs` 资源，使 `sharp` 的原生 addon 可以 `dlopen` libvips（pkg 的 VFS 无法满足它的 RPATH）。

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
node --import tsx/esm scripts/build-tauri-sidecar.ts --targets node24-macos-arm64
pnpm tauri build        # from apps/tauri
```

第一步构建 `dsh-web` sidecar，并将其 sharp libvips 库输出到 `apps/tauri/binaries/`；然后 `tauri build` 将两者打包。输出为 `src-tauri/target/release/bundle/macos/DeepSeek Harness.app` 和一个 `.dmg`。注意：构建 `.app`/`.dmg` 需要 macOS（bundle、代码签名和 `icon.icns` 处理都是 macOS 专用步骤）；在安装 WebKitGTK 4.1 开发包后，Rust 本身的 `cargo check`/`cargo build` 可在 Linux 上工作。

应用版本来自仓库根 `package.json`。推送匹配的 `dsh-v<version>` tag 会运行 macOS 工作流，并创建包含已构建 DMG 的 GitHub Release；像 `dsh-v0.1.1-rc.2` 这样的预发布版本会创建 GitHub 预发布。分支、Pull Request 和未标记 tag 的手动运行只保留七天期的 Actions 产物。从匹配 tag 选择的手动运行也会发布 release。

## 配置

- `DSH_BIN`——覆盖要启动的二进制文件（默认：打包的 `dsh-web` sidecar，然后是 `PATH` 上的 `dsh`）。
- `DSH_REMOTE_URL=http://host:port`——远程模式：加载已在运行的 `dsh --profile web` 宿主，而不是启动本地 sidecar。**Remote ▸ Connect to Remote…** 菜单项以交互方式完成同一操作。
- 其他所有项（API key、`DSH_HOME`、`--host` 等）都是 dsh 自身的配置，并通过继承的环境传入。只有实际运行 agent 时才需要 `DEEPSEEK_API_KEY`；没有它也可以打开 GUI。

## 已知限制和后续工作

- **单文件 exe 加一个共享库。** sidecar 本身是单文件，但 `sharp`（图像附件）需要在其旁边提供 libvips 库（`apps/tauri/binaries/sharp-libs`），因为 pkg 的 VFS 无法满足 `.node` RPATH。Node-pty 的 macOS `spawn-helper` 对持久终端也需要同样的处理。
- **回环 HTTP，无 IPC bridge。** 我们使用浏览器同样使用的 `http://127.0.0.1:<port>` 传输。如果 shell 以后需要通过 `file://` 加载 `dist/`，宿主的 `FetchHandler`/`AbstractApiClient.doFetch` seam 是预定的 IPC bridge 插入点（见 `packages/host/apiproxy` 和 `packages/host/webserver`）。
- **占位图标。** 由 `apps/web/public/favicon.svg` 生成；发行前需替换为正式品牌图标集。
- **Ad-hoc 签名。** 显式的 `-` 签名身份可防止 Apple Silicon 将下载的应用报告为已损坏。由于嵌入的 Node/V8 sidecar 需要可执行内存，此无密钥构建会禁用 hardened runtime；release 工作流会在发布前启动已签名的 sidecar。由于应用尚未公证，首次启动时仍可能需要在**系统设置 ▸ 隐私与安全性**中批准。要实现无警告分发，需要在 CI 中配置 Developer ID Application 证书和 Apple 公证凭据。
