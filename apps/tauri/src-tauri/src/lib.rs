//! Desktop entry point: spawn the `dsh --profile web` host and open a native
//! webview on the loopback URL it serves.
//!
//! The Web GUI is entirely dsh's own frontend — this crate is only the shell.
//! It talks to the host over the ordinary loopback HTTP/RPC surface (the same
//! same-origin `/api` fetch and event WebSockets a browser uses), so the
//! frontend needs no changes and there is no Tauri IPC bridge.

pub mod dsh;

use std::sync::Mutex;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dsh = match dsh::DshProcess::start() {
        Ok(dsh) => dsh,
        Err(err) => {
            eprintln!("dsh-tauri: {err}");
            std::process::exit(1);
        }
    };
    let url: url::Url = dsh
        .web_url()
        .parse()
        .expect("dsh-tauri: host printed a malformed URL");

    tauri::Builder::default()
        .setup(move |app| {
            // Own the host for the app's lifetime; dropped (and killed) on exit.
            app.manage(Mutex::new(dsh));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("DeepSeek Harness")
                .inner_size(1200.0, 800.0)
                .min_inner_size(800.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
