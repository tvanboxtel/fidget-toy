use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Window,
};

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
            // is the only way to quit.
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Fidget Toy")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
