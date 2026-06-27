use crate::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::process::Command;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub path: String,
    pub branch: String,
    pub is_dirty: bool,
    pub staged_files: Vec<String>,
    pub unstaged_files: Vec<String>,
    pub ahead: u32,
    pub behind: u32,
}

fn get_and_validate_git_project(
    state: &crate::project::ProjectRegistry,
    project_id: &str,
    write_required: bool,
) -> Result<PathBuf, AppError> {
    // 1. Validate active project ID
    {
        let active_guard = state
            .active_project_id
            .lock()
            .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?;
        match &*active_guard {
            Some(active_id) if active_id == project_id => {}
            _ => {
                return Err(AppError::GitError(
                    "Access denied: Project is not the active project".to_string(),
                ))
            }
        }
    }

    // 2. Retrieve project config
    let projects_guard = state
        .projects
        .lock()
        .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?;
    let project = projects_guard
        .get(project_id)
        .ok_or_else(|| AppError::GitError("Access denied: Project not found in registry".to_string()))?;

    // 3. Check permission
    if write_required && project.permissions == "read" {
        return Err(AppError::GitError(
            "Permission denied: write access not allowed".to_string(),
        ));
    }

    let repo_path = std::path::Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::GitError(format!("Failed to canonicalize repository path: {}", e)))?;

    Ok(repo_path)
}

#[tauri::command]
pub async fn git_detect_repo(start_path: String) -> Result<Option<String>, AppError> {
    let mut current_dir = PathBuf::from(&start_path);
    loop {
        let git_dir = current_dir.join(".git");
        if git_dir.is_dir() {
            return Ok(Some(current_dir.to_string_lossy().into_owned()));
        }
        if !current_dir.pop() {
            break;
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn git_get_status(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
) -> Result<GitStatus, AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, false)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    if !repo_path.exists() {
        return Err(AppError::GitError("Repository path does not exist".to_string()));
    }

    // 1. Check if inside work tree
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to execute git: {}", e)))?;

    if !output.status.success() {
        return Ok(GitStatus {
            is_repo: false,
            path: repo_path_str,
            branch: String::new(),
            is_dirty: false,
            staged_files: Vec::new(),
            unstaged_files: Vec::new(),
            ahead: 0,
            behind: 0,
        });
    }

    // 2. Get current branch
    let branch_output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("branch")
        .arg("--show-current")
        .output()
        .await
        .map_err(|e| AppError::GitError(e.to_string()))?;
    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    // 3. Get status --porcelain
    let status_output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("status")
        .arg("--porcelain")
        .output()
        .await
        .map_err(|e| AppError::GitError(e.to_string()))?;

    let status_str = String::from_utf8_lossy(&status_output.stdout);
    let mut staged_files = Vec::new();
    let mut unstaged_files = Vec::new();
    let mut is_dirty = false;

    for line in status_str.lines() {
        if line.len() < 3 {
            continue;
        }
        let index_status = &line[0..1];
        let work_tree_status = &line[1..2];
        let file_path = line[3..].to_string();

        is_dirty = true;

        // XY status porcelain
        // X = staged status
        // Y = unstaged status
        if index_status != " " && index_status != "?" {
            staged_files.push(file_path.clone());
        }
        if work_tree_status != " " || index_status == "?" {
            unstaged_files.push(file_path);
        }
    }

    // 4. Ahead / Behind tracking
    let mut ahead = 0;
    let mut behind = 0;
    let rev_output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("rev-list")
        .arg("--left-right")
        .arg("--count")
        .arg("HEAD...HEAD@{u}")
        .output()
        .await;

    if let Ok(output) = rev_output {
        if output.status.success() {
            let rev_str = String::from_utf8_lossy(&output.stdout);
            let parts: Vec<&str> = rev_str.split_whitespace().collect();
            if parts.len() == 2 {
                ahead = parts[0].parse::<u32>().unwrap_or(0);
                behind = parts[1].parse::<u32>().unwrap_or(0);
            }
        }
    }

    Ok(GitStatus {
        is_repo: true,
        path: repo_path_str,
        branch,
        is_dirty,
        staged_files,
        unstaged_files,
        ahead,
        behind,
    })
}

#[tauri::command]
pub async fn git_create_commit(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    message: String,
    files: Option<Vec<String>>,
    author_name: Option<String>,
    author_email: Option<String>,
    bypass_hooks: bool,
) -> Result<String, AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, true)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    // 1. Stage files
    if let Some(file_list) = files {
        if !file_list.is_empty() {
            let mut cmd = Command::new("git");
            cmd.arg("-C").arg(&repo_path_str).arg("add");
            for f in file_list {
                cmd.arg(f);
            }
            let add_output = cmd
                .output()
                .await
                .map_err(|e| AppError::GitError(format!("Failed to stage files: {}", e)))?;
            if !add_output.status.success() {
                return Err(AppError::GitError(
                    String::from_utf8_lossy(&add_output.stderr).to_string(),
                ));
            }
        }
    } else {
        // Stage all changes
        let add_output = Command::new("git")
            .arg("-C")
            .arg(&repo_path_str)
            .arg("add")
            .arg("-A")
            .output()
            .await
            .map_err(|e| AppError::GitError(format!("Failed to stage changes: {}", e)))?;
        if !add_output.status.success() {
            return Err(AppError::GitError(
                String::from_utf8_lossy(&add_output.stderr).to_string(),
            ));
        }
    }

    // 2. Commit
    let mut commit_cmd = Command::new("git");
    commit_cmd
        .arg("-C")
        .arg(&repo_path_str)
        .arg("commit")
        .arg("-m")
        .arg(&message);

    if bypass_hooks {
        commit_cmd.arg("--no-verify");
    }

    // Apply identity overrides
    if let Some(name) = author_name {
        commit_cmd.env("GIT_AUTHOR_NAME", &name);
        commit_cmd.env("GIT_COMMITTER_NAME", &name);
    }
    if let Some(email) = author_email {
        commit_cmd.env("GIT_AUTHOR_EMAIL", &email);
        commit_cmd.env("GIT_COMMITTER_EMAIL", &email);
    }

    let commit_output = commit_cmd
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to commit changes: {}", e)))?;

    if !commit_output.status.success() {
        return Err(AppError::GitError(
            String::from_utf8_lossy(&commit_output.stderr).to_string(),
        ));
    }

    Ok(String::from_utf8_lossy(&commit_output.stdout)
        .trim()
        .to_string())
}

#[tauri::command]
pub async fn git_undo_last_commit(
    app: AppHandle,
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
) -> Result<(), AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, true)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    // Require native confirmation dialog for destructive action
    use tauri_plugin_dialog::DialogExt;
    let confirmed = app
        .dialog()
        .message("Are you sure you want to undo the last commit? This will perform a soft reset, preserving your changes in the staging area.")
        .title("Undo Last Commit Confirmation")
        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
        .blocking_show();

    if !confirmed {
        return Err(AppError::GitError("Undo commit cancelled by user".to_string()));
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("reset")
        .arg("--soft")
        .arg("HEAD~1")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to undo last commit: {}", e)))?;

    if !output.status.success() {
        return Err(AppError::GitError(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn git_checkout_branch(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    branch: String,
) -> Result<(), AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, true)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("checkout")
        .arg(branch)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to checkout branch: {}", e)))?;

    if !output.status.success() {
        return Err(AppError::GitError(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn git_diff_changes(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
) -> Result<String, AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, false)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("diff")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to run git diff: {}", e)))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout);

    // Also include cached diff (staged)
    let cached_output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("diff")
        .arg("--cached")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to run git diff --cached: {}", e)))?;

    let cached_str = String::from_utf8_lossy(&cached_output.stdout);

    let mut combined_diff = String::new();
    if !stdout_str.is_empty() {
        combined_diff.push_str("--- UNSTAGED CHANGES ---\n");
        combined_diff.push_str(&stdout_str);
    }
    if !cached_str.is_empty() {
        if !combined_diff.is_empty() {
            combined_diff.push_str("\n");
        }
        combined_diff.push_str("--- STAGED CHANGES ---\n");
        combined_diff.push_str(&cached_str);
    }

    Ok(combined_diff)
}
