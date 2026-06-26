use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, Window,
};

/// Show and focus the settings window (created hidden at startup).
fn open_settings(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Restrict the window's input region to a single rectangle (the ball's
/// bounding box, in physical pixels relative to the window). Clicks outside it
/// pass through to whatever is behind the window; clicks inside hit the ball.
///
/// This is the cross-platform-on-Linux replacement for the global-cursor poll:
/// Wayland refuses to report the global cursor position, but it honours a GTK
/// input shape. The frontend calls this every frame as the ball moves.
#[cfg(target_os = "linux")]
#[tauri::command]
fn set_input_region(window: Window, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    use gtk::cairo::{Region, RectangleInt};
    use gtk::prelude::*;

    let gtk_win = window.gtk_window().map_err(|e| e.to_string())?;
    let gdk_win = gtk_win
        .window()
        .ok_or_else(|| "gdk window not realized yet".to_string())?;

    let region = Region::create_rectangle(&RectangleInt::new(x, y, w, h));
    gdk_win.input_shape_combine_region(&region, 0, 0);
    Ok(())
}

/// No-op on non-Linux targets; those platforms use the global-cursor poll +
/// set_ignore_cursor_events strategy instead. Kept so the frontend can call it
/// everywhere without per-platform branching.
#[cfg(not(target_os = "linux"))]
#[tauri::command]
fn set_input_region(_window: Window, _x: i32, _y: i32, _w: i32, _h: i32) -> Result<(), String> {
    Ok(())
}

/// Cursor position in logical (CSS) pixels relative to the window's top-left.
///
/// Used on macOS/Windows for click-through: the whole window ignores cursor
/// events by default, and the frontend polls this to toggle that off only while
/// the cursor is over the ball. (Linux can't rely on this under Wayland, so it
/// uses the input-shape approach in set_input_region instead.)
#[cfg(not(target_os = "linux"))]
#[tauri::command]
fn cursor_pos(window: Window) -> Result<(f64, f64), String> {
    let global = window.cursor_position().map_err(|e| e.to_string())?;
    let origin = window.outer_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let x = (global.x - origin.x as f64) / scale;
    let y = (global.y - origin.y as f64) / scale;
    Ok((x, y))
}

/// On Linux this is never called (input-shape handles click-through), but the
/// command must exist so generate_handler! resolves on every platform.
#[cfg(target_os = "linux")]
#[tauri::command]
fn cursor_pos(_window: Window) -> Result<(f64, f64), String> {
    Ok((-1.0, -1.0))
}

/// The running app's version (baked in at compile time from Cargo.toml). The
/// settings window compares this against the latest GitHub release.
#[tauri::command]
fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Open a URL in the user's default browser. Used by the "Get the update"
/// button to send people to the releases page. We shell out to the platform
/// opener rather than pulling in a plugin.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        // `start` is a cmd builtin; the empty "" is the window-title arg it eats.
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", "", &url]);
        c
    };

    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            set_input_region,
            cursor_pos,
            current_version,
            open_url
        ])
        .setup(|app| {
            // The window is borderless and lives in the tray, so the tray menu
            // is the only way to reach settings or quit.
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings, &sep, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Fidget Toy")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "settings" => open_settings(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Closing the settings window should just hide it, not destroy it,
            // so reopening from the tray is instant and state is preserved.
            if let Some(settings_win) = app.get_webview_window("settings") {
                let win = settings_win.clone();
                settings_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
