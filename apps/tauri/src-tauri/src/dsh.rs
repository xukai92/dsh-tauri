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
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

/// How long to wait for the host's readiness line before failing startup.
const READY_TIMEOUT: Duration = Duration::from_secs(30);
/// Grace period between the host process group's termination request and its
/// forced shutdown.
const STOP_TIMEOUT: Duration = Duration::from_secs(6);

/// `dsh --profile web` arguments. `--port 0` asks the OS to assign a free port,
/// so two shells never collide; the actual URL comes from the readiness line.
const DSH_ARGS: [&str; 5] = ["--profile", "web", "--port", "0", "--no-open"];

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
        #[cfg(unix)]
        command.process_group(0);
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

/// Stop the owned host process tree and reap its leader; best-effort on both counts.
fn reap(child: &mut Child) {
    #[cfg(unix)]
    {
        let process_group = child.id() as std::ffi::c_int;
        signal_process_group(process_group, 15);
        let deadline = Instant::now() + STOP_TIMEOUT;
        while Instant::now() < deadline {
            let _ = child.try_wait();
            if !process_group_exists(process_group) {
                let _ = child.wait();
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        signal_process_group(process_group, 9);
    }
    #[cfg(not(unix))]
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(unix)]
fn signal_process_group(process_group: std::ffi::c_int, signal: std::ffi::c_int) {
    // The child is spawned as the leader of a process group owned by this
    // supervisor, so a negative pid targets only that owned tree.
    unsafe {
        unsafe extern "C" {
            fn kill(pid: std::ffi::c_int, signal: std::ffi::c_int) -> std::ffi::c_int;
        }
        kill(-process_group, signal);
    }
}

#[cfg(unix)]
fn process_group_exists(process_group: std::ffi::c_int) -> bool {
    unsafe extern "C" {
        fn kill(pid: std::ffi::c_int, signal: std::ffi::c_int) -> std::ffi::c_int;
    }
    unsafe { kill(-process_group, 0) == 0 }
}

/// Extract the complete loopback URL from the canonical readiness line.
fn parse_web_url(line: &str) -> Option<String> {
    let candidate = line.strip_prefix("dsh web: ")?.split_whitespace().next()?;
    let after_host = candidate.strip_prefix("http://127.0.0.1:")?;
    let port_end = after_host.find(['/', '?', '#']).unwrap_or(after_host.len());
    let port = after_host[..port_end].parse::<u16>().ok()?;
    if port == 0 {
        return None;
    }
    Some(candidate.to_owned())
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
    fn preserves_path_and_auth_query() {
        assert_eq!(
            parse_web_url("dsh web: http://127.0.0.1:43210/?token=secret"),
            Some("http://127.0.0.1:43210/?token=secret".to_owned()),
        );
    }

    #[test]
    fn ignores_lines_without_a_loopback_url() {
        assert_eq!(parse_web_url("some other output"), None);
        assert_eq!(parse_web_url("http://192.168.1.7:43210"), None);
        assert_eq!(parse_web_url("log: http://127.0.0.1:43210"), None);
        assert_eq!(parse_web_url("dsh web: http://127.0.0.1/path"), None);
        assert_eq!(parse_web_url("dsh web: http://user@127.0.0.1:43210"), None);
    }
}
