use crate::AppError;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[tauri::command]
pub async fn project_read_file(path: String) -> Result<String, AppError> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(AppError::AppPath(format!("File does not exist: {}", path.display())));
    }
    fs::read_to_string(path).map_err(|e| AppError::AppPath(format!("Failed to read file: {}", e)))
}

#[tauri::command]
pub async fn project_write_file(path: String, content: String) -> Result<(), AppError> {
    let path = PathBuf::from(&path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::AppPath(format!("Failed to create directories: {}", e)))?;
    }
    fs::write(path, content).map_err(|e| AppError::AppPath(format!("Failed to write file: {}", e)))
}

#[tauri::command]
pub async fn project_list_dir(path: String) -> Result<Vec<String>, AppError> {
    let path = PathBuf::from(&path);
    if !path.exists() || !path.is_dir() {
        return Err(AppError::AppPath(format!("Directory does not exist: {}", path.display())));
    }
    
    let mut entries = Vec::new();
    let dir = fs::read_dir(path).map_err(|e| AppError::AppPath(format!("Failed to read dir: {}", e)))?;
    
    for entry in dir {
        if let Ok(entry) = entry {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                entries.push(format!("{}/", file_name));
            } else {
                entries.push(file_name);
            }
        }
    }
    entries.sort();
    Ok(entries)
}

#[tauri::command]
pub async fn project_run_command(command: String, cwd: String) -> Result<String, AppError> {
    let cwd_path = Path::new(&cwd);
    
    let output = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", &command])
            .current_dir(cwd_path)
            .output()
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(&command)
            .current_dir(cwd_path)
            .output()
    }.map_err(|e| AppError::AppPath(format!("Failed to execute command: {}", e)))?;

    let mut result = String::new();
    if !output.stdout.is_empty() {
        result.push_str(&String::from_utf8_lossy(&output.stdout));
    }
    if !output.stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str("--- STDERR ---\n");
        result.push_str(&String::from_utf8_lossy(&output.stderr));
    }

    if !output.status.success() {
        result = format!("Command exited with error code: {}\n{}", output.status.code().unwrap_or(-1), result);
    }

    Ok(result)
}

#[tauri::command]
pub async fn create_project_dir(app: tauri::AppHandle, name: String) -> Result<String, AppError> {
    let doc_dir = app
        .path()
        .document_dir()
        .map_err(|e| AppError::AppPath(format!("Failed to get document directory: {}", e)))?;
    
    // Clean name to be a valid folder name (remove invalid characters)
    let safe_name: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '_' })
        .collect();
    
    let safe_name = safe_name.trim().to_string();
    if safe_name.is_empty() {
        return Err(AppError::AppPath("Project name cannot be empty".to_string()));
    }
    
    let project_path = doc_dir.join(safe_name);
    fs::create_dir_all(&project_path)
        .map_err(|e| AppError::AppPath(format!("Failed to create project directory: {}", e)))?;
    
    Ok(project_path.to_string_lossy().to_string())
}
