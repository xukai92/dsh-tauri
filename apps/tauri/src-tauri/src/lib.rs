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

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Managed host state: the running local sidecar, or `None` in remote mode.
type HostState = Mutex<Option<dsh::DshProcess>>;

/// Navigate the main window to a remote host; used by the connect form.
#[tauri::command]
fn connect_remote(
    app: tauri::AppHandle,
    url: String,
    state: tauri::State<'_, HostState>,
) -> Result<(), String> {
    let parsed = url
        .trim()
        .parse::<url::Url>()
        .map_err(|err| err.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("URL must start with http:// or https://".to_owned());
    }
    if let Some(window) = app.get_webview_window("main") {
        window.navigate(parsed).map_err(|err| err.to_string())?;
    }
    // Release the local host (kills it) so remote mode doesn't keep it running.
    if let Ok(mut guard) = state.lock() {
        *guard = None;
    }
    if let Some(remote) = app.get_webview_window("remote") {
        let _ = remote.close();
    }
    Ok(())
}

/// Navigate the main window back to a local host, spawning one if needed.
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
    if let Some(window) = app.get_webview_window("main") {
        window.navigate(url).map_err(|err| err.to_string())?;
    }
    if let Some(remote) = app.get_webview_window("remote") {
        let _ = remote.close();
    }
    Ok(())
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

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![connect_remote])
        .setup(move |app| {
            // Own the host for the app's lifetime; dropped (and killed) on exit.
            // `None` in remote mode.
            app.manage(HostState::new(dsh));

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
            let menu = Menu::with_items(app, &[&submenu])?;
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
