//! Spawn and supervise the `dsh --profile web` host and discover the loopback
//! URL it serves the Web GUI on.
//!
//! The host prints a readiness line once its plugin tree has settled:
//!
//! ```text
//! dsh web: http://127.0.0.1:<port>            # optionally ` (LAN: http://ip:port)`
//! ```
//!
//! This module owns that child process for the whole app lifetime and kills it
//! on drop, so quitting the shell tears the host down with it.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::channel;
use std::time::Duration;

/// How long to wait for the host's readiness line before failing startup.
const READY_TIMEOUT: Duration = Duration::from_secs(30);

/// `dsh --profile web` arguments. `--port 0` asks the OS to assign a free port,
/// so two shells never collide; the actual URL comes from the readiness line.
const DSH_ARGS: [&str; 4] = ["--profile", "web", "--port", "0"];

/// Resolve the host binary: the bundled Tauri sidecar (`dsh-web` beside this
/// executable), else `DSH_BIN`, else `dsh` on `PATH`.
fn resolve_bin() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = dir.join("dsh-web");
            if sidecar.is_file() {
                return sidecar;
            }
        }
    }
    std::env::var_os("DSH_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("dsh"))
}

/// The emitted sharp libvips directory, bundled as a resource next to the app.
/// Sharp's `.node` dlopens libvips via an RPATH that pkg's flat VFS cannot
/// satisfy, so the spawn sets the dynamic-library search path to this directory.
fn sharp_libs_dir() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let candidates = if cfg!(target_os = "macos") {
        vec![exe_dir.join("../Resources").join("sharp-libs")]
    } else {
        vec![
            exe_dir.join("sharp-libs"),
            exe_dir.join("../lib").join("sharp-libs"),
        ]
    };
    candidates.into_iter().find(|path| path.is_dir())
}

/// A running `dsh --profile web` host plus the URL its Web GUI is served on.
pub struct DshProcess {
    child: Child,
    url: String,
}

/// Startup failure: the host could not be spawned or never announced its URL.
#[derive(Debug)]
pub struct DshError(String);

impl std::fmt::Display for DshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for DshError {}

impl DshProcess {
    /// Spawn the bundled sidecar (or `DSH_BIN`/`dsh`) and block until ready.
    pub fn start() -> Result<Self, DshError> {
        let bin = resolve_bin();
        Self::start_with(&bin.to_string_lossy())
    }

    /// Spawn `bin --profile web --port 0` and block until it prints its URL.
    pub fn start_with(bin: &str) -> Result<Self, DshError> {
        let mut command = Command::new(bin);
        command
            .args(DSH_ARGS)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        if let Some(libdir) = sharp_libs_dir() {
            // The host's stderr stays on ours: diagnostics appear in the
            // developer's terminal (or macOS Console.app when packaged).
            let var = if cfg!(target_os = "macos") {
                "DYLD_LIBRARY_PATH"
            } else {
                "LD_LIBRARY_PATH"
            };
            let existing = std::env::var(var).unwrap_or_default();
            let value = if existing.is_empty() {
                libdir.to_string_lossy().into_owned()
            } else {
                format!("{}:{existing}", libdir.display())
            };
            command.env(var, value);
        }
        let mut child = command
            .spawn()
            .map_err(|err| DshError(format!("failed to spawn `{bin} --profile web`: {err}")))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| DshError("failed to capture dsh stdout".to_owned()))?;

        // Read stdout on a worker so a slow host parks that thread, not the
        // caller. The thread keeps draining the pipe for the host's whole
        // lifetime (a closed read end would make the host's later stdout
        // writes EPIPE): it forwards the readiness URL over the channel and
        // echoes every other line to our own stdout.
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            let mut announced = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if !announced {
                    if let Some(url) = parse_web_url(&line) {
                        announced = true;
                        let _ = tx.send(Some(url));
                        continue;
                    }
                }
                println!("{line}");
            }
            if !announced {
                let _ = tx.send(None); // stdout closed before any readiness line
            }
        });

        match rx.recv_timeout(READY_TIMEOUT) {
            Ok(Some(url)) => Ok(Self { child, url }),
            Ok(None) => {
                reap(&mut child);
                Err(DshError(
                    "dsh exited before announcing its Web URL".to_owned(),
                ))
            }
            Err(_) => {
                reap(&mut child);
                Err(DshError(format!(
                    "dsh did not announce its Web URL within {READY_TIMEOUT:?}"
                )))
            }
        }
    }

    /// The loopback URL the Web GUI is served on.
    pub fn web_url(&self) -> &str {
        &self.url
    }
}

impl Drop for DshProcess {
    fn drop(&mut self) {
        reap(&mut self.child);
    }
}

/// Kill the host and reap it; best-effort on both counts.
fn reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Extract the loopback URL from a readiness line, e.g.
/// `dsh web: http://127.0.0.1:43210 (LAN: http://192.168.1.7:43210)`.
fn parse_web_url(line: &str) -> Option<String> {
    const MARKER: &str = "http://127.0.0.1:";
    let rest = &line[line.find(MARKER)? + MARKER.len()..];
    let port: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if port.is_empty() {
        None
    } else {
        Some(format!("http://127.0.0.1:{port}"))
    }
}

#[cfg(test)]
mod tests {
    use super::parse_web_url;

    #[test]
    fn parses_bare_readiness_line() {
        assert_eq!(
            parse_web_url("dsh web: http://127.0.0.1:43210"),
            Some("http://127.0.0.1:43210".to_owned()),
        );
    }

    #[test]
    fn parses_readiness_line_with_lan_suffix() {
        assert_eq!(
            parse_web_url("dsh web: http://127.0.0.1:43210 (LAN: http://192.168.1.7:43210)"),
            Some("http://127.0.0.1:43210".to_owned()),
        );
    }

    #[test]
    fn ignores_lines_without_a_loopback_url() {
        assert_eq!(parse_web_url("some other output"), None);
        assert_eq!(parse_web_url("http://192.168.1.7:43210"), None);
    }
}
