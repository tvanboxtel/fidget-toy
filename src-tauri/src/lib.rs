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

/// No-op on non-Linux targets; those platforms use a different click-through
/// strategy (global-cursor poll). Kept so the frontend can call it everywhere.
#[cfg(not(target_os = "linux"))]
#[tauri::command]
fn set_input_region(_window: Window, _x: i32, _y: i32, _w: i32, _h: i32) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_input_region])
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
