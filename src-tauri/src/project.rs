use crate::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectPermission {
    Read,
    Write,
    Full,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub permissions: ProjectPermission,
    #[serde(default)]
    pub exclude_patterns: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt_override: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_override: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_auto_commit_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_commit_msg_template: Option<String>,
}

pub struct ProjectRegistry {
    pub projects: Mutex<HashMap<String, Project>>,
    pub active_project_id: Mutex<Option<String>>,
    pub project_path_overrides: Mutex<HashMap<String, String>>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ValidatedWorktree {
    pub path: PathBuf,
    pub branch: String,
}

pub(crate) fn sythoria_worktree_root() -> PathBuf {
    std::env::temp_dir().join("sythoria-worktrees")
}

fn is_sythoria_agent_branch(branch: &str) -> bool {
    branch
        .strip_prefix("sythoria-agent-")
        .is_some_and(|suffix| {
            suffix.len() == 8 && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
}

fn parse_git_worktrees(output: &[u8]) -> Vec<ValidatedWorktree> {
    let mut worktrees = Vec::new();
    let mut path = None;
    let mut branch = None;

    for raw_field in output.split(|byte| *byte == 0) {
        if raw_field.is_empty() {
            if let (Some(path), Some(branch)) = (path.take(), branch.take()) {
                worktrees.push(ValidatedWorktree { path, branch });
            }
            continue;
        }

        let field = String::from_utf8_lossy(raw_field);
        if let Some(value) = field.strip_prefix("worktree ") {
            path = Some(PathBuf::from(value));
        } else if let Some(value) = field.strip_prefix("branch refs/heads/") {
            branch = Some(value.to_string());
        }
    }

    if let (Some(path), Some(branch)) = (path, branch) {
        worktrees.push(ValidatedWorktree { path, branch });
    }
    worktrees
}

/// Validates that a renderer-supplied path is both inside Sythoria's dedicated
/// temporary root and registered by Git as a worktree of the selected project.
pub(crate) fn validate_owned_worktree(
    project: &Project,
    worktree_path: &str,
    expected_branch: Option<&str>,
) -> Result<ValidatedWorktree, AppError> {
    let owned_root = sythoria_worktree_root()
        .canonicalize()
        .map_err(|_| AppError::AppPath("No Sythoria worktree root is available".to_string()))?;
    let candidate = Path::new(worktree_path)
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Invalid worktree path: {e}")))?;

    if candidate == owned_root || !candidate.starts_with(&owned_root) {
        return Err(AppError::AppPath(
            "Access denied: worktree is outside the Sythoria-owned root".to_string(),
        ));
    }

    let project_root = Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize project root: {e}")))?;
    let output = Command::new("git")
        .arg("-C")
        .arg(&project_root)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .arg("-z")
        .output()
        .map_err(|e| AppError::AppPath(format!("Failed to inspect Git worktrees: {e}")))?;
    if !output.status.success() {
        return Err(AppError::AppPath(
            "Access denied: project worktrees could not be verified".to_string(),
        ));
    }

    let verified = parse_git_worktrees(&output.stdout)
        .into_iter()
        .find_map(|entry| {
            let entry_path = entry.path.canonicalize().ok()?;
            (entry_path == candidate).then_some(ValidatedWorktree {
                path: entry_path,
                branch: entry.branch,
            })
        })
        .ok_or_else(|| {
            AppError::AppPath(
                "Access denied: path is not a registered worktree for this project".to_string(),
            )
        })?;

    if !is_sythoria_agent_branch(&verified.branch) {
        return Err(AppError::AppPath(
            "Access denied: worktree is not owned by Sythoria".to_string(),
        ));
    }
    if expected_branch.is_some_and(|branch| branch != verified.branch) {
        return Err(AppError::AppPath(
            "Access denied: worktree branch does not match".to_string(),
        ));
    }

    Ok(verified)
}

pub(crate) fn resolve_project_root(
    state: &ProjectRegistry,
    project: &Project,
    project_id: &str,
    requested_worktree: Option<&str>,
) -> Result<PathBuf, AppError> {
    let stored_override = if requested_worktree.is_none() {
        state
            .project_path_overrides
            .lock()
            .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?
            .get(project_id)
            .cloned()
    } else {
        None
    };

    if let Some(worktree) = requested_worktree.or(stored_override.as_deref()) {
        return Ok(validate_owned_worktree(project, worktree, None)?.path);
    }

    Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize project root: {e}")))
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

impl Default for ProjectRegistry {
    fn default() -> Self {
        Self::new()
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
    let content =
        serde_json::to_string_pretty(&projects).map_err(|e| AppError::ConfigIo(e.to_string()))?;
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
    let canonical_override = if let Some(path) = path_override.as_deref() {
        let projects_guard = state
            .projects
            .lock()
            .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
        let project = projects_guard.get(&project_id).ok_or_else(|| {
            AppError::AppPath("Access denied: Project not found in registry".to_string())
        })?;
        Some(
            validate_owned_worktree(project, path, None)?
                .path
                .to_string_lossy()
                .into_owned(),
        )
    } else {
        None
    };

    let mut overrides_guard = state
        .project_path_overrides
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    if let Some(path) = canonical_override {
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
            if project.permissions == ProjectPermission::Read {
                return Err(AppError::AppPath(
                    "Permission denied: write access not allowed".to_string(),
                ));
            }
        }
        "full" if project.permissions != ProjectPermission::Full => {
            return Err(AppError::AppPath(
                "Permission denied: full shell access not allowed".to_string(),
            ));
        }
        _ => {} // read requires no check, since all projects have at least read permissions
    }

    let root = Path::new(&project.path);
    let root_canonical = root
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize project root: {}", e)))?;

    let user_path = Path::new(relative_path);
    if user_path.is_absolute() {
        return Err(AppError::AppPath(
            "Absolute paths are not allowed".to_string(),
        ));
    }
    let full_path = root_canonical.join(user_path);

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
            if !pattern_trimmed.is_empty()
                && crate::search::matches_wildcard(&resolved_str, pattern_trimmed)
            {
                return Err(AppError::AppPath(format!(
                    "Access denied: path '{}' matches exclude pattern '{}'",
                    resolved.display(),
                    pattern_trimmed
                )));
            }
        }
    }

    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::{
        is_sythoria_agent_branch, parse_git_worktrees, validate_owned_worktree, Project,
        ProjectPermission,
    };
    use std::path::PathBuf;

    fn test_project(path: PathBuf) -> Project {
        Project {
            id: "project".to_string(),
            name: "Project".to_string(),
            path: path.to_string_lossy().into_owned(),
            permissions: ProjectPermission::Full,
            exclude_patterns: None,
            system_prompt_override: None,
            model_override: None,
            is_auto_commit_enabled: None,
            auto_commit_msg_template: None,
        }
    }

    #[test]
    fn project_optional_settings_survive_json_round_trip() {
        let mut project = test_project(PathBuf::from("C:/workspace"));
        project.system_prompt_override = Some("Be concise".to_string());
        project.model_override = Some("model-x".to_string());
        project.is_auto_commit_enabled = Some(true);
        project.auto_commit_msg_template = Some("feat: {summary}".to_string());

        let json = serde_json::to_string(&project).expect("serialize project");
        let decoded: Project = serde_json::from_str(&json).expect("deserialize project");

        assert_eq!(
            decoded.system_prompt_override,
            project.system_prompt_override
        );
        assert_eq!(decoded.model_override, project.model_override);
        assert_eq!(decoded.is_auto_commit_enabled, Some(true));
        assert_eq!(
            decoded.auto_commit_msg_template,
            project.auto_commit_msg_template
        );
        assert!(json.contains("systemPromptOverride"));
        assert!(json.contains("isAutoCommitEnabled"));
    }

    #[test]
    fn project_permissions_reject_unknown_values() {
        let json = r#"{
            "id":"project",
            "name":"Project",
            "path":"C:/workspace",
            "permissions":"owner"
        }"#;

        assert!(serde_json::from_str::<Project>(json).is_err());
    }

    #[test]
    fn parses_nul_delimited_git_worktree_metadata() {
        let entries = parse_git_worktrees(
            b"worktree C:/repo\0HEAD abc\0branch refs/heads/main\0\0worktree C:/tmp/wt\0HEAD def\0branch refs/heads/sythoria-agent-a1b2c3d4\0\0",
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].branch, "sythoria-agent-a1b2c3d4");
    }

    #[test]
    fn agent_branch_names_are_strictly_scoped() {
        assert!(is_sythoria_agent_branch("sythoria-agent-a1b2c3d4"));
        assert!(!is_sythoria_agent_branch("main"));
        assert!(!is_sythoria_agent_branch("sythoria-agent-too-long"));
        assert!(!is_sythoria_agent_branch("sythoria-agent-../../x"));
    }

    #[test]
    fn arbitrary_existing_directory_cannot_be_used_as_worktree() {
        let current = std::env::current_dir().expect("current directory");
        let project = test_project(current.clone());
        assert!(validate_owned_worktree(&project, &current.to_string_lossy(), None).is_err());
    }
}
