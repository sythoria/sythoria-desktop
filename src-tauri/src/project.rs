use crate::secure_storage::{self, StorageDomain};
use crate::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::AppHandle;

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

#[derive(Clone, Debug)]
pub(crate) struct ProjectExclusions {
    root: PathBuf,
    matcher: ignore::gitignore::Gitignore,
}

impl ProjectExclusions {
    pub(crate) fn new(project: &Project, root: &Path) -> Result<Self, AppError> {
        let mut builder = ignore::gitignore::GitignoreBuilder::new(root);
        builder
            .case_insensitive(cfg!(target_os = "windows"))
            .map_err(|error| {
                AppError::AppPath(format!("Failed to configure project exclusions: {error}"))
            })?;

        if let Some(patterns) = &project.exclude_patterns {
            for raw_pattern in patterns {
                let Some(pattern) = normalize_exclusion_pattern(raw_pattern)? else {
                    continue;
                };
                builder.add_line(None, &pattern).map_err(|error| {
                    AppError::AppPath(format!(
                        "Invalid project exclusion pattern '{}': {error}",
                        raw_pattern.trim()
                    ))
                })?;
            }
        }

        let matcher = builder.build().map_err(|error| {
            AppError::AppPath(format!("Failed to compile project exclusions: {error}"))
        })?;
        Ok(Self {
            root: root.to_path_buf(),
            matcher,
        })
    }

    fn matching_pattern(&self, path: &Path, is_dir: bool) -> Option<&str> {
        if !path.starts_with(&self.root) {
            return None;
        }
        match self.matcher.matched_path_or_any_parents(path, is_dir) {
            ignore::Match::Ignore(glob) => Some(glob.original()),
            ignore::Match::None | ignore::Match::Whitelist(_) => None,
        }
    }

    pub(crate) fn ensure_allowed(&self, path: &Path, is_dir: bool) -> Result<(), AppError> {
        if let Some(pattern) = self.matching_pattern(path, is_dir) {
            return Err(AppError::AppPath(format!(
                "Access denied: path '{}' matches exclude pattern '{}'",
                path.display(),
                pattern
            )));
        }
        Ok(())
    }

    pub(crate) fn allows_discovered_path(&self, path: &Path, is_dir: bool) -> bool {
        if !path.starts_with(&self.root) || self.ensure_allowed(path, is_dir).is_err() {
            return false;
        }
        let Ok(canonical) = path.canonicalize() else {
            return false;
        };
        canonical.starts_with(&self.root)
            && self.ensure_allowed(&canonical, canonical.is_dir()).is_ok()
    }
}

fn normalize_exclusion_pattern(raw_pattern: &str) -> Result<Option<String>, AppError> {
    let mut pattern = raw_pattern.trim().replace('\\', "/");
    while let Some(stripped) = pattern.strip_prefix("./") {
        pattern = stripped.to_string();
    }
    if pattern.is_empty() {
        return Ok(None);
    }
    if pattern.starts_with('!') {
        return Err(AppError::AppPath(
            "Project exclusion patterns cannot use negation ('!')".to_string(),
        ));
    }
    if pattern.split('/').any(|component| component == "..") {
        return Err(AppError::AppPath(
            "Project exclusion patterns must be root-relative and cannot contain '..'".to_string(),
        ));
    }
    if pattern.starts_with('#') {
        pattern.insert(0, '\\');
    }
    Ok(Some(pattern))
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
        if let Some(projects) =
            secure_storage::load_json::<Vec<Project>>(app, StorageDomain::Projects)?
        {
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
    let projects: Vec<Project> =
        secure_storage::load_json(&app, StorageDomain::Projects)?.unwrap_or_default();

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
    secure_storage::save_json(&app, StorageDomain::Projects, &projects)?;

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

fn configure_project_run(
    state: &ProjectRegistry,
    project_id: &str,
    worktree_path: Option<&str>,
    branch_name: Option<&str>,
) -> Result<(), AppError> {
    let project = state
        .projects
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?
        .get(project_id)
        .cloned()
        .ok_or_else(|| {
            AppError::AppPath("Access denied: Project not found in registry".to_string())
        })?;

    let canonical_override = match (worktree_path, branch_name) {
        (None, None) if project.permissions == ProjectPermission::Read => None,
        (None, None) => {
            return Err(AppError::AppPath(
                "Write-capable project runs require an isolated worktree".to_string(),
            ));
        }
        (Some(_), _) if project.permissions == ProjectPermission::Read => {
            return Err(AppError::AppPath(
                "Read-only project runs cannot use a writable worktree".to_string(),
            ));
        }
        (Some(path), Some(branch)) => Some(
            validate_owned_worktree(&project, path, Some(branch))?
                .path
                .to_string_lossy()
                .into_owned(),
        ),
        _ => {
            return Err(AppError::AppPath(
                "Worktree path and branch must be provided together".to_string(),
            ));
        }
    };

    let mut overrides_guard = state
        .project_path_overrides
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    if let Some(path) = canonical_override {
        overrides_guard.insert(project_id.to_string(), path);
    } else {
        overrides_guard.remove(project_id);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn project_run_begin(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    worktree_path: Option<String>,
    branch_name: Option<String>,
) -> Result<(), AppError> {
    configure_project_run(
        &state,
        &project_id,
        worktree_path.as_deref(),
        branch_name.as_deref(),
    )
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

    let exclusions = ProjectExclusions::new(project, &root_canonical)?;
    exclusions.ensure_allowed(&clean_path, clean_path.is_dir())?;
    exclusions.ensure_allowed(&resolved, resolved.is_dir())?;

    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::{
        configure_project_run, is_sythoria_agent_branch, parse_git_worktrees,
        validate_owned_worktree, validate_project_path, Project, ProjectExclusions,
        ProjectPermission, ProjectRegistry,
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

    #[test]
    fn read_only_project_run_uses_the_project_root_without_a_worktree() {
        let registry = ProjectRegistry::new();
        let mut project = test_project(PathBuf::from("C:/workspace"));
        project.permissions = ProjectPermission::Read;
        registry
            .projects
            .lock()
            .expect("projects lock")
            .insert(project.id.clone(), project);
        registry
            .project_path_overrides
            .lock()
            .expect("overrides lock")
            .insert("project".to_string(), "stale-worktree".to_string());

        configure_project_run(&registry, "project", None, None).expect("begin read-only run");

        assert!(!registry
            .project_path_overrides
            .lock()
            .expect("overrides lock")
            .contains_key("project"));
    }

    #[test]
    fn write_project_run_rejects_a_missing_worktree() {
        let registry = ProjectRegistry::new();
        let project = test_project(PathBuf::from("C:/workspace"));
        registry
            .projects
            .lock()
            .expect("projects lock")
            .insert(project.id.clone(), project);

        assert!(configure_project_run(&registry, "project", None, None).is_err());
    }

    #[test]
    fn root_relative_exclusions_match_nested_files_and_directories() {
        let root =
            std::env::temp_dir().join(format!("sythoria-exclusions-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src/node_modules/pkg")).expect("create node_modules");
        std::fs::create_dir_all(root.join("nested/.git")).expect("create nested git directory");
        std::fs::write(root.join("src/node_modules/pkg/index.js"), "secret")
            .expect("write dependency file");
        std::fs::write(root.join("nested/.git/config"), "secret").expect("write git config");
        std::fs::write(root.join("nested/.env"), "TOKEN=secret").expect("write env file");
        std::fs::write(root.join("visible.txt"), "visible").expect("write visible file");

        let mut project = test_project(root.clone());
        project.permissions = ProjectPermission::Read;
        project.exclude_patterns = Some(vec!["node_modules".into(), ".git".into(), ".env".into()]);

        assert!(validate_project_path(&project, "src/node_modules/pkg/index.js", "read").is_err());
        assert!(validate_project_path(&project, "nested/.git/config", "read").is_err());
        assert!(validate_project_path(&project, "nested/.env", "read").is_err());
        assert!(validate_project_path(&project, "visible.txt", "read").is_ok());

        std::fs::remove_dir_all(&root).expect("remove test root");
    }

    #[cfg(unix)]
    #[test]
    fn symlink_aliases_to_excluded_paths_are_rejected() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!("sythoria-symlink-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("private")).expect("create private directory");
        std::fs::write(root.join("private/secret.txt"), "secret").expect("write secret");
        symlink(root.join("private"), root.join("alias")).expect("create symlink");

        let mut project = test_project(root.clone());
        project.permissions = ProjectPermission::Read;
        project.exclude_patterns = Some(vec!["private".into()]);

        assert!(validate_project_path(&project, "alias/secret.txt", "read").is_err());

        std::fs::remove_dir_all(&root).expect("remove test root");
    }

    #[test]
    fn exclusion_matcher_rejects_reinclusion_patterns() {
        let root = std::env::temp_dir().join(format!("sythoria-pattern-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create test root");
        let mut project = test_project(root.clone());
        project.exclude_patterns = Some(vec!["!secret.txt".into()]);

        assert!(ProjectExclusions::new(&project, &root).is_err());

        std::fs::remove_dir_all(&root).expect("remove test root");
    }
}
