use crate::AppError;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
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
    worktree_path: Option<&str>,
    allow_worktree_override: bool,
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
        .ok_or_else(|| {
            AppError::GitError("Access denied: Project not found in registry".to_string())
        })?
        .clone();
    drop(projects_guard);

    // 3. Check permission
    if write_required && project.permissions == crate::project::ProjectPermission::Read {
        return Err(AppError::GitError(
            "Permission denied: write access not allowed".to_string(),
        ));
    }

    let repo_path = if allow_worktree_override {
        crate::project::resolve_project_root(state, &project, project_id, worktree_path)
            .map_err(|e| AppError::GitError(e.to_string()))?
    } else {
        Path::new(&project.path)
            .canonicalize()
            .map_err(|e| AppError::GitError(format!("Failed to canonicalize project root: {e}")))?
    };

    Ok(repo_path)
}

fn resolve_git_relative_path(root: &Path, relative_path: &str) -> Result<PathBuf, AppError> {
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::GitError(
            "Git returned an unsafe workspace-relative path".to_string(),
        ));
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|e| AppError::GitError(format!("Failed to canonicalize workspace root: {e}")))?;
    let candidate = canonical_root.join(relative);
    let mut existing = candidate.as_path();
    while !existing.exists() {
        existing = existing.parent().ok_or_else(|| {
            AppError::GitError("Git path has no existing workspace ancestor".to_string())
        })?;
    }
    let canonical_ancestor = existing
        .canonicalize()
        .map_err(|e| AppError::GitError(format!("Failed to validate Git path: {e}")))?;
    if !canonical_ancestor.starts_with(&canonical_root) {
        return Err(AppError::GitError(
            "Access denied: Git path escapes the workspace".to_string(),
        ));
    }

    Ok(candidate)
}

fn parse_changed_paths(output: &[u8]) -> Result<Vec<String>, AppError> {
    let mut fields = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty());
    let mut paths = Vec::new();

    while let Some(status) = fields.next() {
        if status.len() != 1 || !matches!(status[0], b'A' | b'M' | b'D' | b'T') {
            return Err(AppError::GitError(format!(
                "Git reported an unsupported worktree change status: {}",
                String::from_utf8_lossy(status)
            )));
        }

        let path = fields.next().ok_or_else(|| {
            AppError::GitError("Git returned a malformed changed-path list".to_string())
        })?;
        let path = String::from_utf8(path.to_vec()).map_err(|_| {
            AppError::GitError("Git returned a non-UTF-8 workspace path".to_string())
        })?;
        paths.push(path);
    }

    Ok(paths)
}

async fn run_git_apply(
    repo_path: &Path,
    patch: &[u8],
    extra_args: &[&str],
    operation: &str,
) -> Result<(), AppError> {
    let mut command = Command::new("git");
    command.arg("-C").arg(repo_path).arg("apply");
    for argument in extra_args {
        command.arg(argument);
    }
    command
        .arg("--binary")
        .arg("--whitespace=nowarn")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| AppError::GitError(format!("Failed to start Git {operation}: {e}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::GitError(format!("Failed to open Git {operation} input")))?;
    stdin
        .write_all(patch)
        .await
        .map_err(|e| AppError::GitError(format!("Failed to write Git {operation} input: {e}")))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to finish Git {operation}: {e}")))?;
    if !output.status.success() {
        return Err(AppError::GitError(format!(
            "Git {operation} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    Ok(())
}

/// Apply every tracked and non-ignored untracked worktree change to the primary
/// working tree. Git validates and applies one binary patch atomically; a reverse
/// dry-run then verifies that the complete patch is present before callers may
/// remove the source worktree.
async fn apply_worktree_changes(
    repo_path: &Path,
    worktree_dir: &Path,
) -> Result<Vec<String>, AppError> {
    let add_output = Command::new("git")
        .arg("-C")
        .arg(worktree_dir)
        .arg("add")
        .arg("-A")
        .arg("--")
        .arg(".")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to stage worktree changes: {e}")))?;
    if !add_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to stage worktree changes: {}",
            String::from_utf8_lossy(&add_output.stderr).trim()
        )));
    }

    let primary_head_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["rev-parse", "HEAD"])
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to resolve primary HEAD: {e}")))?;
    if !primary_head_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to resolve primary HEAD: {}",
            String::from_utf8_lossy(&primary_head_output.stderr).trim()
        )));
    }
    let primary_head = String::from_utf8_lossy(&primary_head_output.stdout)
        .trim()
        .to_string();
    let merge_base_output = Command::new("git")
        .arg("-C")
        .arg(worktree_dir)
        .args(["merge-base", "HEAD", &primary_head])
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to resolve worktree merge base: {e}")))?;
    if !merge_base_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to resolve worktree merge base: {}",
            String::from_utf8_lossy(&merge_base_output.stderr).trim()
        )));
    }
    let merge_base = String::from_utf8_lossy(&merge_base_output.stdout)
        .trim()
        .to_string();
    if merge_base.is_empty() {
        return Err(AppError::GitError(
            "Failed to resolve worktree merge base: Git returned an empty revision".to_string(),
        ));
    }

    // Disabling rename detection gives one explicit path per create/delete, so
    // every path embedded in the patch can be validated against both roots.
    // Comparing the staged worktree state to the branch merge base includes
    // both committed branch-ahead changes and current uncommitted changes.
    let names_output = Command::new("git")
        .arg("-C")
        .arg(worktree_dir)
        .arg("diff")
        .arg("--cached")
        .arg("--name-status")
        .arg("-z")
        .arg("--no-renames")
        .arg(&merge_base)
        .arg("--")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to list worktree changes: {e}")))?;
    if !names_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to list worktree changes: {}",
            String::from_utf8_lossy(&names_output.stderr).trim()
        )));
    }

    let changed_paths = parse_changed_paths(&names_output.stdout)?;
    for path in &changed_paths {
        resolve_git_relative_path(worktree_dir, path)?;
        resolve_git_relative_path(repo_path, path)?;
    }

    if changed_paths.is_empty() {
        return Ok(changed_paths);
    }

    let patch_output = Command::new("git")
        .arg("-C")
        .arg(worktree_dir)
        .arg("diff")
        .arg("--cached")
        .arg("--binary")
        .arg("--full-index")
        .arg("--no-ext-diff")
        .arg("--no-renames")
        .arg(&merge_base)
        .arg("--")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to build worktree patch: {e}")))?;
    if !patch_output.status.success() || patch_output.stdout.is_empty() {
        return Err(AppError::GitError(format!(
            "Failed to build a complete worktree patch: {}",
            String::from_utf8_lossy(&patch_output.stderr).trim()
        )));
    }

    run_git_apply(repo_path, &patch_output.stdout, &["--check"], "apply check").await?;
    run_git_apply(repo_path, &patch_output.stdout, &[], "apply").await?;
    run_git_apply(
        repo_path,
        &patch_output.stdout,
        &["--reverse", "--check"],
        "apply verification",
    )
    .await?;

    Ok(changed_paths)
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
    worktree_path: Option<String>,
) -> Result<GitStatus, AppError> {
    let repo_path =
        get_and_validate_git_project(&state, &project_id, false, worktree_path.as_deref(), true)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    if !repo_path.exists() {
        return Err(AppError::GitError(
            "Repository path does not exist".to_string(),
        ));
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

async fn create_commit_in_repository(
    repo_path: &Path,
    message: &str,
    files: Option<&[String]>,
    author_name: Option<&str>,
    author_email: Option<&str>,
    bypass_hooks: bool,
) -> Result<String, AppError> {
    let repo_path_str = repo_path.to_string_lossy().into_owned();
    if files.is_some_and(<[String]>::is_empty) {
        return Err(AppError::GitError(
            "A scoped commit requires at least one file".to_string(),
        ));
    }

    // 1. Stage the requested scope. A later `git commit --only` prevents
    // unrelated paths that the user already staged from entering this commit.
    if let Some(file_list) = files {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(&repo_path_str).arg("add").arg("--");
        for file in file_list {
            cmd.arg(file);
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
        .arg(message);

    if bypass_hooks {
        commit_cmd.arg("--no-verify");
    }
    if let Some(file_list) = files {
        commit_cmd.arg("--only").arg("--");
        for file in file_list {
            commit_cmd.arg(file);
        }
    }

    // Apply identity overrides
    if let Some(name) = author_name {
        commit_cmd.env("GIT_AUTHOR_NAME", name);
        commit_cmd.env("GIT_COMMITTER_NAME", name);
    }
    if let Some(email) = author_email {
        commit_cmd.env("GIT_AUTHOR_EMAIL", email);
        commit_cmd.env("GIT_COMMITTER_EMAIL", email);
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
#[allow(clippy::too_many_arguments)]
pub async fn git_create_commit(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    message: String,
    files: Option<Vec<String>>,
    author_name: Option<String>,
    author_email: Option<String>,
    bypass_hooks: bool,
    worktree_path: Option<String>,
) -> Result<String, AppError> {
    let repo_path =
        get_and_validate_git_project(&state, &project_id, true, worktree_path.as_deref(), true)?;
    create_commit_in_repository(
        &repo_path,
        &message,
        files.as_deref(),
        author_name.as_deref(),
        author_email.as_deref(),
        bypass_hooks,
    )
    .await
}

#[tauri::command]
pub async fn git_undo_last_commit(
    app: AppHandle,
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
) -> Result<(), AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, true, None, false)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    // Require native confirmation dialog for destructive action
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message("Are you sure you want to undo the last commit? This will perform a soft reset, preserving your changes in the staging area.")
        .title("Undo Last Commit Confirmation")
        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });

    let confirmed = rx.await.unwrap_or(false);

    if !confirmed {
        return Err(AppError::GitError(
            "Undo commit cancelled by user".to_string(),
        ));
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
    let repo_path = get_and_validate_git_project(&state, &project_id, true, None, false)?;

    switch_branch_in_repository(&repo_path, &branch).await
}

fn git_switch_is_unavailable(stderr: &[u8]) -> bool {
    let message = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    message.contains("is not a git command") || message.contains("unknown subcommand: 'switch'")
}

async fn switch_branch_in_repository(repo_path: &Path, branch: &str) -> Result<(), AppError> {
    let validation = Command::new("git")
        .arg("check-ref-format")
        .arg("--branch")
        .arg(branch)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to validate branch name: {e}")))?;

    if !validation.status.success() {
        return Err(AppError::GitError(format!(
            "Invalid Git branch name: {branch}"
        )));
    }

    let status = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("status")
        .arg("--porcelain=v1")
        .arg("--untracked-files=normal")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to inspect repository state: {e}")))?;

    if !status.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to inspect repository state: {}",
            String::from_utf8_lossy(&status.stderr).trim()
        )));
    }

    if !status.stdout.is_empty() {
        return Err(AppError::GitError(
            "Cannot switch branches while the repository has staged, unstaged, or untracked changes. Commit or stash them first."
                .to_string(),
        ));
    }

    // `git switch` attaches a detached HEAD to the requested branch. Git versions
    // older than 2.23 do not provide it, so fall back only when the subcommand is
    // unavailable. The branch has already passed Git's ref-name validation.
    let switch_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("switch")
        .arg(branch)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to switch branch: {e}")))?;

    if switch_output.status.success() {
        return Ok(());
    }

    if !git_switch_is_unavailable(&switch_output.stderr) {
        return Err(AppError::GitError(
            String::from_utf8_lossy(&switch_output.stderr)
                .trim()
                .to_string(),
        ));
    }

    let checkout_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("checkout")
        .arg(branch)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to switch branch with legacy Git: {e}")))?;

    if !checkout_output.status.success() {
        return Err(AppError::GitError(
            String::from_utf8_lossy(&checkout_output.stderr)
                .trim()
                .to_string(),
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn git_diff_changes(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    worktree_path: Option<String>,
    files: Option<Vec<String>>,
) -> Result<String, AppError> {
    let repo_path =
        get_and_validate_git_project(&state, &project_id, false, worktree_path.as_deref(), true)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    let mut diff_cmd = Command::new("git");
    diff_cmd.arg("-C").arg(&repo_path_str).arg("diff").arg("--");
    if let Some(file_list) = files.as_ref() {
        diff_cmd.args(file_list);
    }
    let output = diff_cmd
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to run git diff: {}", e)))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout);

    // Also include cached diff (staged)
    let mut cached_diff_cmd = Command::new("git");
    cached_diff_cmd
        .arg("-C")
        .arg(&repo_path_str)
        .arg("diff")
        .arg("--cached")
        .arg("--");
    if let Some(file_list) = files.as_ref() {
        cached_diff_cmd.args(file_list);
    }
    let cached_output = cached_diff_cmd
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
            combined_diff.push('\n');
        }
        combined_diff.push_str("--- STAGED CHANGES ---\n");
        combined_diff.push_str(&cached_str);
    }

    Ok(combined_diff)
}

#[tauri::command]
pub async fn git_worktree_create(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
) -> Result<(String, String), AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, true, None, false)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    // 1. Generate unique branch name and worktree path
    let uuid = uuid::Uuid::new_v4().to_string();
    let branch_name = format!("sythoria-agent-{}", &uuid[0..8]);

    let worktree_root = crate::project::sythoria_worktree_root();
    std::fs::create_dir_all(&worktree_root)
        .map_err(|e| AppError::GitError(format!("Failed to create worktree root: {e}")))?;
    let temp_dir = worktree_root.join(&uuid[0..8]);
    let worktree_path_str = temp_dir.to_string_lossy().into_owned();

    // 2. Spawn git worktree add
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("worktree")
        .arg("add")
        .arg(&worktree_path_str)
        .arg("-b")
        .arg(&branch_name)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to run git worktree add: {}", e)))?;

    if !output.status.success() {
        return Err(AppError::GitError(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let projects_guard = state
        .projects
        .lock()
        .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?;
    let project = projects_guard.get(&project_id).ok_or_else(|| {
        AppError::GitError("Access denied: Project not found in registry".to_string())
    })?;
    crate::project::validate_owned_worktree(project, &worktree_path_str, Some(&branch_name))
        .map_err(|e| AppError::GitError(e.to_string()))?;

    Ok((worktree_path_str, branch_name))
}

#[tauri::command]
pub async fn git_worktree_apply(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    worktree_path: String,
    branch_name: String,
) -> Result<Vec<String>, AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, true, None, false)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    let project = state
        .projects
        .lock()
        .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?
        .get(&project_id)
        .cloned()
        .ok_or_else(|| {
            AppError::GitError("Access denied: Project not found in registry".to_string())
        })?;
    let verified =
        crate::project::validate_owned_worktree(&project, &worktree_path, Some(&branch_name))
            .map_err(|e| AppError::GitError(e.to_string()))?;
    let worktree_dir = verified.path;

    // Cleanup is intentionally unreachable until the complete patch has been
    // applied and independently verified by Git.
    let changed_paths = apply_worktree_changes(&repo_path, &worktree_dir).await?;
    cleanup_worktree_internal(&project, &repo_path_str, &worktree_path, &branch_name).await?;

    Ok(changed_paths)
}

#[tauri::command]
pub async fn git_worktree_discard(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    worktree_path: String,
    branch_name: String,
) -> Result<(), AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, true, None, false)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();
    let project = state
        .projects
        .lock()
        .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?
        .get(&project_id)
        .cloned()
        .ok_or_else(|| {
            AppError::GitError("Access denied: Project not found in registry".to_string())
        })?;

    // Clean up worktree and delete temp branch
    cleanup_worktree_internal(&project, &repo_path_str, &worktree_path, &branch_name).await?;

    Ok(())
}

async fn cleanup_worktree_internal(
    project: &crate::project::Project,
    repo_path: &str,
    worktree_path: &str,
    branch_name: &str,
) -> Result<(), AppError> {
    let verified =
        crate::project::validate_owned_worktree(project, worktree_path, Some(branch_name))
            .map_err(|e| AppError::GitError(e.to_string()))?;

    // 1. Remove the worktree using git worktree remove --force
    let remove_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg("--")
        .arg(&verified.path)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to remove git worktree: {}", e)))?;

    if !remove_output.status.success() {
        return Err(AppError::GitError(format!(
            "Git refused to remove the verified worktree: {}",
            String::from_utf8_lossy(&remove_output.stderr).trim()
        )));
    }

    // 2. Delete the temporary branch using git branch -D
    let delete_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("branch")
        .arg("-D")
        .arg("--")
        .arg(branch_name)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to delete temporary branch: {}", e)))?;

    if !delete_output.status.success() {
        return Err(AppError::GitError(format!(
            "Worktree was removed, but its temporary branch could not be deleted: {}",
            String::from_utf8_lossy(&delete_output.stderr).trim()
        )));
    }

    // Git is the sole authority allowed to remove a worktree. Never recursively
    // delete a renderer-supplied path as a fallback.
    if verified.path.exists() {
        return Err(AppError::GitError(
            "Git reported success but the worktree directory still exists".to_string(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_worktree_changes, create_commit_in_repository, parse_changed_paths,
        resolve_git_relative_path, switch_branch_in_repository,
    };
    use std::path::Path;
    use std::process::Command as StdCommand;

    struct TestRepository {
        root: std::path::PathBuf,
        repo: std::path::PathBuf,
        worktree: std::path::PathBuf,
    }

    impl TestRepository {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "sythoria-worktree-apply-test-{}",
                uuid::Uuid::new_v4()
            ));
            let repo = root.join("repo");
            let worktree = root.join("worktree");
            std::fs::create_dir_all(&repo).expect("create test repository");
            run_git(&repo, &["init"]);
            run_git(&repo, &["config", "user.email", "tests@sythoria.invalid"]);
            run_git(&repo, &["config", "user.name", "Sythoria Tests"]);
            run_git(&repo, &["config", "commit.gpgsign", "false"]);
            run_git(&repo, &["config", "core.autocrlf", "false"]);
            std::fs::write(repo.join("modified.txt"), b"original\n").expect("write fixture");
            std::fs::write(repo.join("deleted.txt"), b"delete me\n").expect("write fixture");
            std::fs::write(repo.join("user.txt"), b"user original\n").expect("write fixture");
            run_git(&repo, &["add", "."]);
            run_git(&repo, &["commit", "-m", "initial"]);
            run_git(
                &repo,
                &[
                    "worktree",
                    "add",
                    "-b",
                    "sythoria-agent-test",
                    worktree.to_str().expect("UTF-8 test path"),
                ],
            );

            Self {
                root,
                repo,
                worktree,
            }
        }
    }

    impl Drop for TestRepository {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn run_git(repo: &Path, args: &[&str]) {
        let output = StdCommand::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("run Git test command");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn git_paths_cannot_escape_the_workspace() {
        let root = std::env::current_dir().expect("current directory");
        assert!(resolve_git_relative_path(&root, "src/lib.rs").is_ok());
        assert!(resolve_git_relative_path(&root, "../outside").is_err());
        assert!(resolve_git_relative_path(&root, "/outside").is_err());
        assert!(resolve_git_relative_path(&root, "").is_err());
    }

    #[test]
    fn changed_path_parser_rejects_malformed_or_unsupported_entries() {
        assert_eq!(
            parse_changed_paths(b"A\0nested/file.txt\0M\0other.txt\0").expect("valid paths"),
            ["nested/file.txt", "other.txt"]
        );
        assert!(parse_changed_paths(b"A\0").is_err());
        assert!(parse_changed_paths(b"R100\0old.txt\0new.txt\0").is_err());
        assert!(parse_changed_paths(b"A\0../outside\0").is_ok());
    }

    #[tokio::test]
    async fn branch_switch_validates_names_and_attaches_detached_head() {
        let fixture = TestRepository::new();
        run_git(&fixture.repo, &["branch", "feature/valid-branch"]);
        run_git(&fixture.repo, &["checkout", "--detach"]);

        switch_branch_in_repository(&fixture.repo, "feature/valid-branch")
            .await
            .expect("switch from detached HEAD");

        let branch = StdCommand::new("git")
            .arg("-C")
            .arg(&fixture.repo)
            .args(["branch", "--show-current"])
            .output()
            .expect("read current branch");
        assert_eq!(
            String::from_utf8_lossy(&branch.stdout).trim(),
            "feature/valid-branch"
        );

        assert!(switch_branch_in_repository(&fixture.repo, "../invalid")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn branch_switch_reports_dirty_state_before_switching() {
        let fixture = TestRepository::new();
        run_git(&fixture.repo, &["branch", "feature/clean-target"]);
        std::fs::write(fixture.repo.join("modified.txt"), b"dirty\n").expect("dirty fixture");

        let error = switch_branch_in_repository(&fixture.repo, "feature/clean-target")
            .await
            .expect_err("dirty repository must not switch");

        assert!(error.to_string().contains("Commit or stash"));
        let branch = StdCommand::new("git")
            .arg("-C")
            .arg(&fixture.repo)
            .args(["branch", "--show-current"])
            .output()
            .expect("read current branch");
        assert_ne!(
            String::from_utf8_lossy(&branch.stdout).trim(),
            "feature/clean-target"
        );
    }

    #[tokio::test]
    async fn worktree_apply_includes_nested_untracked_files_and_deletions() {
        let fixture = TestRepository::new();
        std::fs::write(fixture.worktree.join("modified.txt"), b"changed\n")
            .expect("modify fixture");
        std::fs::remove_file(fixture.worktree.join("deleted.txt")).expect("delete fixture");
        let nested = fixture.worktree.join("new/deep/tree");
        std::fs::create_dir_all(&nested).expect("create nested fixture");
        std::fs::write(nested.join("payload.bin"), [0, 1, 2, 0xff]).expect("write binary fixture");

        let changed_paths = apply_worktree_changes(&fixture.repo, &fixture.worktree)
            .await
            .expect("apply complete worktree");

        assert_eq!(
            changed_paths,
            [
                "deleted.txt".to_string(),
                "modified.txt".to_string(),
                "new/deep/tree/payload.bin".to_string(),
            ]
        );

        assert_eq!(
            std::fs::read(fixture.repo.join("modified.txt")).expect("read modified result"),
            b"changed\n"
        );
        assert!(!fixture.repo.join("deleted.txt").exists());
        assert_eq!(
            std::fs::read(fixture.repo.join("new/deep/tree/payload.bin"))
                .expect("read nested result"),
            [0, 1, 2, 0xff]
        );
        assert!(fixture.worktree.exists(), "apply helper must not clean up");
    }

    #[tokio::test]
    async fn worktree_apply_includes_committed_and_uncommitted_branch_changes() {
        let fixture = TestRepository::new();
        std::fs::write(
            fixture.worktree.join("committed.txt"),
            b"committed agent change\n",
        )
        .expect("write committed fixture");
        run_git(&fixture.worktree, &["add", "--", "committed.txt"]);
        run_git(&fixture.worktree, &["commit", "-m", "agent commit"]);
        std::fs::write(
            fixture.worktree.join("uncommitted.txt"),
            b"uncommitted agent change\n",
        )
        .expect("write uncommitted fixture");

        let changed_paths = apply_worktree_changes(&fixture.repo, &fixture.worktree)
            .await
            .expect("apply complete branch state");

        assert_eq!(
            changed_paths,
            ["committed.txt".to_string(), "uncommitted.txt".to_string()]
        );
        assert_eq!(
            std::fs::read(fixture.repo.join("committed.txt")).expect("read committed result"),
            b"committed agent change\n"
        );
        assert_eq!(
            std::fs::read(fixture.repo.join("uncommitted.txt")).expect("read uncommitted result"),
            b"uncommitted agent change\n"
        );
    }

    #[tokio::test]
    async fn failed_apply_keeps_worktree_and_source_changes_intact() {
        let fixture = TestRepository::new();
        std::fs::write(fixture.worktree.join("modified.txt"), b"worktree version\n")
            .expect("modify worktree fixture");
        std::fs::write(
            fixture.repo.join("modified.txt"),
            b"conflicting primary version\n",
        )
        .expect("modify primary fixture");

        assert!(apply_worktree_changes(&fixture.repo, &fixture.worktree)
            .await
            .is_err());
        assert!(
            fixture.worktree.exists(),
            "failed apply removed its worktree"
        );
        assert_eq!(
            std::fs::read(fixture.worktree.join("modified.txt")).expect("read source change"),
            b"worktree version\n"
        );
        assert_eq!(
            std::fs::read(fixture.repo.join("modified.txt")).expect("read primary conflict"),
            b"conflicting primary version\n"
        );
    }

    #[tokio::test]
    async fn scoped_commit_preserves_unrelated_staged_changes() {
        let fixture = TestRepository::new();
        std::fs::write(fixture.repo.join("modified.txt"), b"AI change\n").expect("write AI change");
        std::fs::write(fixture.repo.join("user.txt"), b"user staged change\n")
            .expect("write user change");
        run_git(&fixture.repo, &["add", "--", "user.txt"]);

        create_commit_in_repository(
            &fixture.repo,
            "fix: scoped change",
            Some(&["modified.txt".to_string()]),
            None,
            None,
            false,
        )
        .await
        .expect("create scoped commit");

        let committed = StdCommand::new("git")
            .arg("-C")
            .arg(&fixture.repo)
            .args(["show", "--pretty=format:", "--name-only", "HEAD"])
            .output()
            .expect("inspect commit");
        assert_eq!(
            String::from_utf8_lossy(&committed.stdout).trim(),
            "modified.txt"
        );

        let staged = StdCommand::new("git")
            .arg("-C")
            .arg(&fixture.repo)
            .args(["diff", "--cached", "--name-only"])
            .output()
            .expect("inspect staged paths");
        assert_eq!(String::from_utf8_lossy(&staged.stdout).trim(), "user.txt");
    }
}
