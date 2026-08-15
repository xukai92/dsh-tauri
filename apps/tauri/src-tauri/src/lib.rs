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

/// Navigate the main window to a remote host; used by the connect form.
#[tauri::command]
fn connect_remote(app: tauri::AppHandle, url: String) -> Result<(), String> {
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
        .inner_size(440.0, 150.0)
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
            app.manage(Mutex::new(dsh));

            let connect = MenuItem::with_id(
                app,
                "connect-remote",
                "Connect to Remote…",
                true,
                None::<&str>,
            )?;
            let submenu = Submenu::with_items(app, "Remote", true, &[&connect])?;
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
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
