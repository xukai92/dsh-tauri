//! Desktop entry point: open a native webview on the DeepSeek Harness Web GUI.
//!
//! Two modes:
//! - **Local** (default): spawn the bundled `dsh-web` sidecar and load the
//!   loopback URL it prints on readiness.
//! - **Remote**: `DSH_REMOTE_URL=http://host:port` (or the "Connect to Remote…"
//!   menu item) loads an already-running `dsh --profile web` host.
//!
//! The Web GUI is entirely dsh's own frontend — this crate is only the shell.
//! It talks to the host over the ordinary same-origin HTTP/RPC surface, so the
//! frontend needs no changes and there is no Tauri IPC bridge.

pub mod dsh;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Managed host state: the running local sidecar, or `None` in remote mode.
type HostState = Mutex<Option<dsh::DshProcess>>;

/// Label of the current content window. Each connection replaces the window
/// instead of navigating it, so the value moves with that window.
type MainWindowState = Mutex<String>;

/// Source of the unique labels a replaced content window is created under.
static NEXT_MAIN_WINDOW: AtomicU64 = AtomicU64::new(1);

/// Load `url` in a fresh content window and retire the previous one.
///
/// The window is created rather than navigated because WebKit withholds a
/// `SameSite=Strict` cookie set during a redirect when the navigation began on
/// a different site. The token exchange would therefore land unauthenticated
/// whenever the current page is the loopback GUI and the target is remote. A
/// new window's first load carries no cross-site initiator, which is the same
/// path the bundled local host already authenticates through.
fn show_main(app: &tauri::AppHandle, url: url::Url) -> Result<(), String> {
    let label = format!("main-{}", NEXT_MAIN_WINDOW.fetch_add(1, Ordering::Relaxed));
    WebviewWindowBuilder::new(app, label.as_str(), WebviewUrl::External(url))
        .title("DeepSeek Harness")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .focused(true)
        .build()
        .map_err(|err| err.to_string())?;
    let state = app.state::<MainWindowState>();
    let previous = {
        let mut guard = state
            .lock()
            .map_err(|_| "main window state is poisoned".to_owned())?;
        std::mem::replace(&mut *guard, label)
    };
    if let Some(window) = app.get_webview_window(&previous) {
        let _ = window.destroy();
    }
    if let Some(remote) = app.get_webview_window("remote") {
        let _ = remote.close();
    }
    Ok(())
}

/// Parse and validate a URL pasted into the remote-connect form.
fn remote_url(raw: &str) -> Result<url::Url, String> {
    let parsed = raw
        .trim()
        .parse::<url::Url>()
        .map_err(|err| err.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("URL must start with http:// or https://".to_owned());
    }
    Ok(parsed)
}

/// Open a remote host in the content window; used by the connect form.
#[tauri::command]
fn connect_remote(
    app: tauri::AppHandle,
    url: String,
    state: tauri::State<'_, HostState>,
) -> Result<(), String> {
    let parsed = remote_url(&url)?;
    show_main(&app, parsed)?;
    // Release the local host (kills it) so remote mode doesn't keep it running.
    if let Ok(mut guard) = state.lock() {
        *guard = None;
    }
    Ok(())
}

/// Open a local host in the content window, spawning one if needed.
fn connect_local(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<HostState>();
    let url = {
        let mut guard = state
            .lock()
            .map_err(|_| "host state is poisoned".to_owned())?;
        if guard.is_none() {
            *guard = Some(dsh::DshProcess::start().map_err(|err| err.to_string())?);
        }
        guard
            .as_ref()
            .expect("host just ensured")
            .web_url()
            .parse::<url::Url>()
            .map_err(|err| err.to_string())?
    };
    show_main(app, url)
}

/// Open the small connect window when the menu item is chosen.
fn open_remote_prompt(app: &tauri::AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("remote").is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "remote", WebviewUrl::App("remote.html".into()))
        .title("Connect to Remote")
        .inner_size(440.0, 220.0)
        .resizable(false)
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Remote mode overrides the local sidecar: no spawn, no managed process.
    let remote = std::env::var("DSH_REMOTE_URL").ok();
    let dsh = if remote.is_some() {
        None
    } else {
        match dsh::DshProcess::start() {
            Ok(host) => Some(host),
            Err(err) => {
                eprintln!("dsh-tauri: {err}");
                std::process::exit(1);
            }
        }
    };
    let url: url::Url = match &remote {
        Some(raw) => raw
            .trim()
            .parse()
            .expect("dsh-tauri: DSH_REMOTE_URL is not a valid URL"),
        None => dsh
            .as_ref()
            .expect("dsh-tauri: no local host in local mode")
            .web_url()
            .parse()
            .expect("dsh-tauri: host printed a malformed URL"),
    };

    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![connect_remote])
        .setup(move |app| {
            // Own the host for the app lifetime; RunEvent::Exit takes it before
            // Tauri terminates the process.
            // `None` in remote mode.
            app.manage(HostState::new(dsh));
            app.manage(MainWindowState::new("main".to_owned()));

            let connect_local =
                MenuItem::with_id(app, "connect-local", "Connect to Local", true, None::<&str>)?;
            let connect_remote = MenuItem::with_id(
                app,
                "connect-remote",
                "Connect to Remote…",
                true,
                None::<&str>,
            )?;
            let submenu =
                Submenu::with_items(app, "Connection", true, &[&connect_local, &connect_remote])?;
            // Start from the standard macOS menu (app menu with Quit, File,
            // Edit, View, Window, Help), then slot Connection in after the app menu.
            let menu = Menu::default(app.handle())?;
            menu.insert(&submenu, 1)?;
            app.set_menu(menu)?;

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("DeepSeek Harness")
                .inner_size(1200.0, 800.0)
                .min_inner_size(800.0, 600.0)
                .build()?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "connect-remote" {
                let _ = open_remote_prompt(app);
            } else if event.id() == "connect-local" {
                let _ = connect_local(app);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app, event| {
        if matches!(event, RunEvent::Exit) {
            // Tauri terminates the process after this callback without
            // dropping managed state. Take the host while its CLI signal
            // handler can still dispose terminals and subprocesses.
            if let Ok(mut host) = app.state::<HostState>().lock() {
                *host = None;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::remote_url;

    #[test]
    fn remote_url_accepts_http_and_https_and_trims_whitespace() {
        assert_eq!(
            remote_url("  http://127.0.0.1:43210/?token=abc  ").map(|url| url.to_string()),
            Ok("http://127.0.0.1:43210/?token=abc".to_owned()),
        );
        assert_eq!(
            remote_url("https://harness.example.ts.net/?token=abc")
                .map(|url| url.scheme().to_owned()),
            Ok("https".to_owned()),
        );
    }

    #[test]
    fn remote_url_rejects_a_non_http_scheme() {
        assert_eq!(
            remote_url("file:///tmp/dsh-web/index.html"),
            Err("URL must start with http:// or https://".to_owned()),
        );
    }
}
