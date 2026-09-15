//! End-to-end test for the host supervisor against a scripted stand-in for
//! `dsh --profile web`: URL discovery through the real reader thread and child
//! cleanup on drop. These exercise the process boundary, not just the pure URL
//! parser.
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[path = "../src/dsh.rs"]
mod dsh;

use dsh::DshProcess;

/// A scratch directory unique to this test run.
fn scratch_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "dsh-tauri-supervisor-{}-{nanos}",
        std::process::id(),
    ));
    fs::create_dir_all(&dir).expect("create scratch dir");
    dir
}

/// Write an executable shell stand-in for `dsh` into `dir` and return its path.
/// The script `cd`s into `dir` first, so `body` can use relative paths.
fn write_script(dir: &Path, body: &str) -> PathBuf {
    let script = dir.join("fake-dsh");
    fs::write(
        &script,
        format!("#!/bin/sh\ncd '{}'\n{body}\n", dir.display()),
    )
    .expect("write script");
    let mut perms = fs::metadata(&script)
        .expect("script metadata")
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&script, perms).expect("chmod script");
    script
}

#[test]
fn discovers_url_and_stops_owned_process_group_on_drop() {
    let dir = scratch_dir();
    let script = write_script(
        &dir,
        r#"trap 'wait; exit 0' TERM
sh -c 'trap "exit 0" TERM; echo "$$" > grandchild.pid; while :; do sleep 1; done' &
echo "$$" > fake.pid
while [ ! -f grandchild.pid ]; do sleep 0.01; done
echo 'preamble: booting host'
echo 'dsh web: http://127.0.0.1:43210/?token=test-token (LAN: http://192.168.1.7:43210)'
while :; do wait || true; done"#,
    );

    let dsh = DshProcess::start_with(script.to_str().expect("utf8 path")).expect("host started");
    assert_eq!(dsh.web_url(), "http://127.0.0.1:43210/?token=test-token");

    let pids = ["fake.pid", "grandchild.pid"].map(|name| {
        fs::read_to_string(dir.join(name))
            .expect("pid file")
            .trim()
            .to_owned()
    });

    drop(dsh);

    let deadline = Instant::now() + Duration::from_secs(2);
    for pid in pids {
        loop {
            let alive = Command::new("kill")
                .arg("-0")
                .arg(&pid)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !alive {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "owned process ({pid}) still alive after drop",
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn errors_when_host_exits_without_announcing_a_url() {
    let dir = scratch_dir();
    let script = write_script(&dir, "echo 'no url here'");
    let result = DshProcess::start_with(script.to_str().expect("utf8 path"));
    assert!(
        result.is_err(),
        "host that never announces must fail startup"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn escalates_after_leader_exits_while_group_descendant_ignores_term() {
    let dir = scratch_dir();
    let script = write_script(
        &dir,
        r#"trap 'exit 0' TERM
sh -c 'trap "" TERM; echo "$$" > stubborn.pid; while :; do sleep 1; done' &
while [ ! -f stubborn.pid ]; do sleep 0.01; done
echo 'dsh web: http://127.0.0.1:43210'
while :; do wait || true; done"#,
    );
    let dsh = DshProcess::start_with(script.to_str().expect("utf8 path")).expect("host started");
    let pid = fs::read_to_string(dir.join("stubborn.pid"))
        .expect("stubborn pid")
        .trim()
        .to_owned();

    let started = Instant::now();
    drop(dsh);
    assert!(
        started.elapsed() >= Duration::from_secs(5),
        "supervisor returned before the CLI disposal grace elapsed",
    );

    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let alive = Command::new("kill")
            .arg("-0")
            .arg(&pid)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !alive {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "stubborn process ({pid}) survived escalation"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = fs::remove_dir_all(&dir);
}
