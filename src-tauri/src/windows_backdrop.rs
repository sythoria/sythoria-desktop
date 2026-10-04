//! Windows behind-window blur for the transparent main window.
//!
//! `window_vibrancy::apply_acrylic` uses the DWM system backdrop
//! (`DWMSBT_TRANSIENTWINDOW`) on Windows 11 22H2+. That backdrop is drawn only
//! when the user's "Transparency effects" setting is on and the window is
//! active, so Sythoria's sidebar would otherwise fall back to a flat fill.
//! The composition accent policy (`SetWindowCompositionAttribute`) renders
//! Acrylic blur independently of that setting and focus state, matching the
//! always-on macOS `NSVisualEffectView` behavior. The WebView paints the
//! palette tint on top, so the native tint stays light and neutral.

use std::ffi::c_void;

type Hwnd = *mut c_void;

const WCA_ACCENT_POLICY: u32 = 0x13;
const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
const DWMWA_SYSTEMBACKDROP_TYPE: u32 = 38;
const DWMSBT_NONE: u32 = 1;

/// Neutral dark tint in `0xAABBGGRR`; acrylic rejects a fully transparent tint.
const ACRYLIC_TINT_ABGR: u32 = 0x3018_1818;

#[repr(C)]
struct AccentPolicy {
    accent_state: u32,
    accent_flags: u32,
    gradient_color: u32,
    animation_id: u32,
}

#[repr(C)]
struct WindowCompositionAttribData {
    attrib: u32,
    pv_data: *mut c_void,
    cb_data: usize,
}

type SetWindowCompositionAttributeFn =
    unsafe extern "system" fn(Hwnd, *mut WindowCompositionAttribData) -> i32;

#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryW(name: *const u16) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const u8) -> *mut c_void;
}

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(hwnd: Hwnd, attribute: u32, value: *const c_void, size: u32) -> i32;
}

/// Applies always-on Acrylic blur. Returns an error when the undocumented
/// composition API is unavailable so the caller can fall back to the DWM path.
pub fn apply_acrylic_blur(window: &tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as Hwnd;
    if hwnd.is_null() {
        return Err("main window handle is unavailable".into());
    }

    // SAFETY: `hwnd` is the live main window handle owned by Tauri. The
    // function pointer is resolved from user32.dll by its exported name and
    // invoked with a correctly sized, stack-owned accent policy.
    unsafe {
        // Ensure the DWM system backdrop does not paint over the accent blur.
        let none = DWMSBT_NONE;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &none as *const u32 as *const c_void,
            std::mem::size_of::<u32>() as u32,
        );

        let library: Vec<u16> = "user32.dll\0".encode_utf16().collect();
        let module = LoadLibraryW(library.as_ptr());
        if module.is_null() {
            return Err("user32.dll could not be loaded".into());
        }
        let procedure = GetProcAddress(module, c"SetWindowCompositionAttribute".as_ptr().cast());
        if procedure.is_null() {
            return Err("SetWindowCompositionAttribute is unavailable".into());
        }
        let set_window_composition_attribute: SetWindowCompositionAttributeFn =
            std::mem::transmute(procedure);

        let mut policy = AccentPolicy {
            accent_state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
            accent_flags: 0,
            gradient_color: ACRYLIC_TINT_ABGR,
            animation_id: 0,
        };
        let mut data = WindowCompositionAttribData {
            attrib: WCA_ACCENT_POLICY,
            pv_data: &mut policy as *mut AccentPolicy as *mut c_void,
            cb_data: std::mem::size_of::<AccentPolicy>(),
        };
        if set_window_composition_attribute(hwnd, &mut data) == 0 {
            return Err("SetWindowCompositionAttribute rejected the acrylic accent".into());
        }
    }
    Ok(())
}
