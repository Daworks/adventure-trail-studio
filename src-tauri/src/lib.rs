use std::{fs, sync::Mutex};

use tauri::{Manager, Runtime};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct ApiSidecar {
    _child: Mutex<Option<CommandChild>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_localhost::Builder::new(1420)
                .host("127.0.0.1")
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            start_api_sidecar(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn start_api_sidecar<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let app_data_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_data_dir)?;
    let database_url = format!(
        "sqlite://{}",
        app_data_dir.join("adventure-trail-studio.db").display()
    );
    let (_events, child) = app
        .shell()
        .sidecar("tourmap-api")?
        .env("TOURMAP_API_ADDR", "127.0.0.1:4000")
        .env("DATABASE_URL", database_url)
        .spawn()?;
    app.manage(ApiSidecar {
        _child: Mutex::new(Some(child)),
    });
    Ok(())
}
