use crate::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub permissions: String, // "read" | "write" | "full"
    pub exclude_patterns: Option<Vec<String>>,
}

pub struct ProjectRegistry {
    pub projects: Mutex<HashMap<String, Project>>,
    pub active_project_id: Mutex<Option<String>>,
    pub project_path_overrides: Mutex<HashMap<String, String>>,
}

impl ProjectRegistry {
    pub fn new() -> Self {
        Self {
            projects: Mutex::new(HashMap::new()),
            active_project_id: Mutex::new(None),
            project_path_overrides: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn load_from_disk(&self, app: &AppHandle) -> Result<(), AppError> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::AppPath(e.to_string()))?;
        let path = app_data_dir.join("projects.json");
        if path.exists() {
            let content = fs::read_to_string(path)?;
            let projects: Vec<Project> = serde_json::from_str(&content).unwrap_or_default();
            let mut projects_guard = self
                .projects
                .lock()
                .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
            projects_guard.clear();
            for p in projects {
                projects_guard.insert(p.id.clone(), p);
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub(crate) async fn load_projects(
    app: AppHandle,
    state: tauri::State<'_, ProjectRegistry>,
) -> Result<Vec<Project>, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let path = app_data_dir.join("projects.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path)?;
    let projects: Vec<Project> = serde_json::from_str(&content).unwrap_or_default();

    let mut projects_guard = state
        .projects
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    projects_guard.clear();
    for p in &projects {
        projects_guard.insert(p.id.clone(), p.clone());
    }
    Ok(projects)
}

#[tauri::command]
pub(crate) async fn save_projects(
    app: AppHandle,
    state: tauri::State<'_, ProjectRegistry>,
    projects: Vec<Project>,
) -> Result<(), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    fs::create_dir_all(&app_data_dir)?;
    let path = app_data_dir.join("projects.json");
    let content = serde_json::to_string_pretty(&projects).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    fs::write(path, content)?;

    let mut projects_guard = state
        .projects
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    projects_guard.clear();
    for p in projects {
        projects_guard.insert(p.id.clone(), p);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn set_active_project(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: Option<String>,
) -> Result<(), AppError> {
    let mut active_guard = state
        .active_project_id
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    *active_guard = project_id;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_project_path_override(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    path_override: Option<String>,
) -> Result<(), AppError> {
    let mut overrides_guard = state
        .project_path_overrides
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    if let Some(path) = path_override {
        overrides_guard.insert(project_id, path);
    } else {
        overrides_guard.remove(&project_id);
    }
    Ok(())
}

/// Helper function to validate if a path is within the project root and is allowed
pub(crate) fn validate_project_path(
    project: &Project,
    relative_path: &str,
    required_permission: &str,
) -> Result<PathBuf, AppError> {
    // Check permission tier
    // required_permission can be "read" or "write"
    match required_permission {
        "write" => {
            if project.permissions == "read" {
                return Err(AppError::AppPath("Permission denied: write access not allowed".to_string()));
            }
        }
        "full" => {
            if project.permissions != "full" {
                return Err(AppError::AppPath("Permission denied: full shell access not allowed".to_string()));
            }
        }
        _ => {} // read requires no check, since all projects have at least read permissions
    }

    let root = Path::new(&project.path);
    let root_canonical = root
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize project root: {}", e)))?;

    let user_path = Path::new(relative_path);
    let full_path = if user_path.is_absolute() {
        user_path.to_path_buf()
    } else {
        root_canonical.join(user_path)
    };

    // Clean traversal
    let mut clean_path = PathBuf::new();
    for component in full_path.components() {
        match component {
            std::path::Component::ParentDir => {
                if !clean_path.pop() {
                    return Err(AppError::AppPath("Path traversal detected".to_string()));
                }
            }
            std::path::Component::CurDir => {}
            _ => {
                clean_path.push(component.as_os_str());
            }
        }
    }

    let resolved = if clean_path.exists() {
        clean_path.canonicalize().map_err(|e| {
            AppError::AppPath(format!("Failed to canonicalize resolved path: {}", e))
        })?
    } else {
        let mut ancestor = clean_path.as_path();
        let mut suffix = PathBuf::new();
        while let Some(parent) = ancestor.parent() {
            if ancestor.exists() {
                break;
            }
            if let Some(name) = ancestor.file_name() {
                let mut new_suffix = PathBuf::from(name);
                new_suffix.push(&suffix);
                suffix = new_suffix;
            }
            ancestor = parent;
        }
        if ancestor.exists() {
            let canon_ancestor = ancestor.canonicalize().map_err(|e| {
                AppError::AppPath(format!("Failed to canonicalize ancestor: {}", e))
            })?;
            canon_ancestor.join(suffix)
        } else {
            clean_path.clone()
        }
    };

    if !resolved.starts_with(&root_canonical) {
        return Err(AppError::AppPath(format!(
            "Access denied: path '{}' is outside workspace '{}'",
            resolved.display(),
            root_canonical.display()
        )));
    }

    // Check exclude patterns
    if let Some(ref patterns) = project.exclude_patterns {
        let resolved_str = resolved.to_string_lossy().to_string();
        for pattern in patterns {
            let pattern_trimmed = pattern.trim();
            if !pattern_trimmed.is_empty() {
                // simple check for containment of excluded directory name (e.g. "/.git/", "/node_modules/")
                // or ending matching
                let clean_pattern = pattern_trimmed.replace("**/", "").replace("/*", "");
                if resolved_str.contains(&clean_pattern) {
                    return Err(AppError::AppPath(format!(
                        "Access denied: path '{}' matches exclude pattern '{}'",
                        resolved.display(),
                        pattern_trimmed
                    )));
                }
            }
        }
    }

    Ok(resolved)
}
