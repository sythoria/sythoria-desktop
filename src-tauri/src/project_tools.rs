use crate::AppError;
use crate::project::ProjectRegistry;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn get_and_validate_project(
    state: &ProjectRegistry,
    project_id: &str,
    relative_path: &str,
    required_permission: &str,
) -> Result<PathBuf, AppError> {
    // 1. Validate active project ID
    {
        let active_guard = state
            .active_project_id
            .lock()
            .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
        match &*active_guard {
            Some(active_id) if active_id == project_id => {}
            _ => {
                return Err(AppError::AppPath(
                    "Access denied: Project is not the active project".to_string(),
                ))
            }
        }
    }

    // 2. Retrieve project config
    let projects_guard = state
        .projects
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    let mut project = projects_guard
        .get(project_id)
        .ok_or_else(|| AppError::AppPath("Access denied: Project not found in registry".to_string()))?
        .clone();

    // Check path override
    {
        let overrides_guard = state
            .project_path_overrides
            .lock()
            .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
        if let Some(overridden_path) = overrides_guard.get(project_id) {
            project.path = overridden_path.clone();
        }
    }

    // 3. Validate path and permission
    crate::project::validate_project_path(&project, relative_path, required_permission)
}

#[tauri::command]
pub async fn project_read(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<String, AppError> {
    let validated_path = get_and_validate_project(&state, &project_id, &path, "read")?;
    tokio::task::spawn_blocking(move || {
        if !validated_path.exists() {
            return Err(AppError::AppPath(format!(
                "File does not exist: {}",
                validated_path.display()
            )));
        }
        let metadata = fs::metadata(&validated_path)
            .map_err(|e| AppError::AppPath(format!("Failed to read metadata: {}", e)))?;
        let size = metadata.len();
        let content = if size > 10 * 1024 * 1024 {
            use std::io::{BufRead, BufReader};
            let file = fs::File::open(&validated_path)
                .map_err(|e| AppError::AppPath(format!("Failed to open file: {}", e)))?;
            let reader = BufReader::new(file);
            let mut lines = Vec::new();
            for line in reader.lines().take(5000) {
                lines.push(
                    line.map_err(|e| AppError::AppPath(format!("Failed to read line: {}", e)))?,
                );
            }
            lines.push(format!("\n--- [WARNING: File size is {:.2}MB, which exceeds the 10MB limit. Loaded first 5000 lines only] ---", size as f64 / (1024.0 * 1024.0)));
            lines.join("\n")
        } else {
            fs::read_to_string(&validated_path)
                .map_err(|e| AppError::AppPath(format!("Failed to read file: {}", e)))?
        };

        if offset.is_some() || limit.is_some() {
            let lines: Vec<&str> = content.lines().collect();
            let start = offset.unwrap_or(1).saturating_sub(1);
            let count = limit.unwrap_or(2000);
            let end = (start + count).min(lines.len());

            if start >= lines.len() {
                return Ok(String::new());
            }

            let slice = &lines[start..end];
            Ok(slice.join("\n"))
        } else {
            Ok(content)
        }
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

#[tauri::command]
pub async fn project_write(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    path: String,
    content: String,
) -> Result<(), AppError> {
    let validated_path = get_and_validate_project(&state, &project_id, &path, "write")?;
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = validated_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::AppPath(format!("Failed to create directories: {}", e)))?;
        }
        fs::write(validated_path, content)
            .map_err(|e| AppError::AppPath(format!("Failed to write file: {}", e)))
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

#[tauri::command]
pub async fn project_list_dir(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    path: String,
) -> Result<Vec<String>, AppError> {
    let validated_path = get_and_validate_project(&state, &project_id, &path, "read")?;
    tokio::task::spawn_blocking(move || {
        if !validated_path.exists() || !validated_path.is_dir() {
            return Err(AppError::AppPath(format!(
                "Directory does not exist: {}",
                validated_path.display()
            )));
        }

        let mut entries = Vec::new();
        let dir = fs::read_dir(validated_path)
            .map_err(|e| AppError::AppPath(format!("Failed to read dir: {}", e)))?;

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
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

#[tauri::command]
pub async fn project_bash(
    app: AppHandle,
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    command: String,
    cwd: String,
    timeout: Option<u64>,
    run_in_background: Option<bool>,
) -> Result<String, AppError> {
    // 1. Validate active project and retrieve config
    let project = {
        {
            let active_guard = state
                .active_project_id
                .lock()
                .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
            match &*active_guard {
                Some(active_id) if active_id == &project_id => {}
                _ => {
                    return Err(AppError::AppPath(
                        "Access denied: Project is not the active project".to_string(),
                    ))
                }
            }
        }
        let projects_guard = state
            .projects
            .lock()
            .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
        projects_guard
            .get(&project_id)
            .ok_or_else(|| AppError::AppPath("Access denied: Project not found in registry".to_string()))?
            .clone()
    };

    if project.permissions != "full" {
        return Err(AppError::AppPath(
            "Permission denied: full shell access not allowed".to_string(),
        ));
    }

    // 2. Validate cwd is exactly the registered project root
    let root_path = Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize project root: {}", e)))?;
    let cwd_path = Path::new(&cwd)
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize cwd: {}", e)))?;

    if root_path != cwd_path {
        return Err(AppError::AppPath(
            "Access denied: command execution directory must be the project root".to_string(),
        ));
    }

    // 3. Require native confirmation
    use tauri_plugin_dialog::DialogExt;
    let confirmed = app
        .dialog()
        .message(format!(
            "The assistant wants to execute the following terminal command in the project directory '{}':\n\n$ {}\n\nWarning: Running commands can modify files or run arbitrary code.",
            project.name, command
        ))
        .title("Execute Command Confirmation")
        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
        .blocking_show();

    if !confirmed {
        return Err(AppError::AppPath("Command execution rejected by user".to_string()));
    }

    let run_bg = run_in_background.unwrap_or(false);

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", &command]);
        c
    } else {
        let mut c = std::process::Command::new("sh");
        c.arg("-c").arg(&command);
        c
    };
    cmd.current_dir(&cwd_path);

    if run_bg {
        cmd.spawn()
            .map_err(|e| AppError::AppPath(format!("Failed to spawn command: {}", e)))?;
        return Ok("Command started in background successfully.".to_string());
    }

    use tokio::process::Command as TokioCommand;
    let mut tcmd = if cfg!(target_os = "windows") {
        let mut c = TokioCommand::new("cmd");
        c.args(["/C", &command]);
        c
    } else {
        let mut c = TokioCommand::new("sh");
        c.arg("-c").arg(&command);
        c
    };
    tcmd.current_dir(&cwd_path);

    let output_future = tcmd.output();
    let output = if let Some(t) = timeout {
        match tokio::time::timeout(std::time::Duration::from_millis(t), output_future).await {
            Ok(Ok(out)) => out,
            Ok(Err(e)) => return Err(AppError::AppPath(format!("Failed to execute command: {}", e))),
            Err(_) => return Err(AppError::AppPath(format!("Command timed out after {}ms", t))),
        }
    } else {
        output_future
            .await
            .map_err(|e| AppError::AppPath(format!("Failed to execute command: {}", e)))?
    };

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
        result = format!(
            "Command exited with error code: {}\n{}",
            output.status.code().unwrap_or(-1),
            result
        );
    }

    Ok(result)
}

#[tauri::command]
pub async fn project_edit(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
) -> Result<(), AppError> {
    let validated_path = get_and_validate_project(&state, &project_id, &path, "write")?;
    tokio::task::spawn_blocking(move || {
        if !validated_path.exists() {
            return Err(AppError::AppPath(format!(
                "File does not exist: {}",
                validated_path.display()
            )));
        }
        let content = fs::read_to_string(&validated_path)
            .map_err(|e| AppError::AppPath(format!("Failed to read file: {}", e)))?;

        let allow_mult = replace_all.unwrap_or(false);
        let count = content.matches(&old_string).count();

        if count == 0 {
            return Err(AppError::AppPath("Target content not found in file.".to_string()));
        }

        if !allow_mult && count > 1 {
            return Err(AppError::AppPath(format!(
                "Target content found {} times, but replace_all is false.",
                count
            )));
        }

        let new_content = content.replace(&old_string, &new_string);
        fs::write(&validated_path, new_content)
            .map_err(|e| AppError::AppPath(format!("Failed to write file: {}", e)))
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

#[derive(serde::Deserialize)]
pub struct ReplacementChunk {
    pub target_content: String,
    pub replacement_content: String,
    pub allow_multiple: Option<bool>,
}

#[tauri::command]
pub async fn project_multi_replace_file_content(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    path: String,
    chunks: Vec<ReplacementChunk>,
) -> Result<(), AppError> {
    let validated_path = get_and_validate_project(&state, &project_id, &path, "write")?;
    tokio::task::spawn_blocking(move || {
        if !validated_path.exists() {
            return Err(AppError::AppPath(format!(
                "File does not exist: {}",
                validated_path.display()
            )));
        }
        let mut content = fs::read_to_string(&validated_path)
            .map_err(|e| AppError::AppPath(format!("Failed to read file: {}", e)))?;

        for (i, chunk) in chunks.iter().enumerate() {
            let count = content.matches(&chunk.target_content).count();
            let allow_mult = chunk.allow_multiple.unwrap_or(false);

            if count == 0 {
                return Err(AppError::AppPath(format!(
                    "Target content for chunk {} not found in file.",
                    i
                )));
            }

            if !allow_mult && count > 1 {
                return Err(AppError::AppPath(format!(
                    "Target content for chunk {} found {} times, but allow_multiple is false.",
                    i, count
                )));
            }

            content = content.replace(&chunk.target_content, &chunk.replacement_content);
        }

        fs::write(&validated_path, content)
            .map_err(|e| AppError::AppPath(format!("Failed to write file: {}", e)))
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

#[derive(serde::Serialize)]
#[serde(untagged)]
pub enum GrepResult {
    FilesWithMatches(Vec<String>),
    Content(Vec<GrepContentResult>),
    Count(usize),
}

#[derive(serde::Serialize)]
pub struct GrepContentResult {
    pub file: String,
    pub line: usize,
    pub content: String,
}

#[tauri::command]
pub async fn project_grep(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    path: String,
    pattern: String,
    output_mode: Option<String>,
    multiline: Option<bool>,
) -> Result<GrepResult, AppError> {
    let validated_root = get_and_validate_project(&state, &project_id, &path, "read")?;
    tokio::task::spawn_blocking(move || {
        if !validated_root.exists() || !validated_root.is_dir() {
            return Err(AppError::AppPath(format!(
                "Directory does not exist: {}",
                validated_root.display()
            )));
        }

        let is_multiline = multiline.unwrap_or(false);
        let mode = output_mode.unwrap_or_else(|| "files_with_matches".to_string());

        let regex = regex::RegexBuilder::new(&pattern)
            .multi_line(is_multiline)
            .build()
            .map_err(|e| AppError::AppPath(format!("Invalid regex: {}", e)))?;

        let mut files_with_matches = Vec::new();
        let mut content_results = Vec::new();
        let mut total_matches = 0;

        let walker = ignore::WalkBuilder::new(&validated_root)
            .hidden(false)
            .git_ignore(true)
            .build();

        for result in walker {
            if let Ok(entry) = result {
                if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    let mut is_large = false;
                    let mut size = 0;
                    if let Ok(metadata) = entry.metadata() {
                        size = metadata.len();
                        if size > 10 * 1024 * 1024 {
                            is_large = true;
                        }
                    }

                    let content_opt = if is_large {
                        use std::io::{BufRead, BufReader};
                        fs::File::open(entry.path()).ok().map(|file| {
                            let reader = BufReader::new(file);
                            let mut lines = Vec::new();
                            for line in reader.lines().take(5000) {
                                if let Ok(l) = line {
                                    lines.push(l);
                                }
                            }
                            lines.push(format!("\n--- [WARNING: File size is {:.2}MB, which exceeds the 10MB limit. Loaded first 5000 lines only] ---", size as f64 / (1024.0 * 1024.0)));
                            lines.join("\n")
                        })
                    } else {
                        fs::read_to_string(entry.path()).ok()
                    };

                    if let Some(content) = content_opt {
                        if regex.is_match(&content) {
                            let rel_path = entry
                                .path()
                                .strip_prefix(&validated_root)
                                .unwrap_or(entry.path());
                            let rel_path_str = rel_path.to_string_lossy().into_owned();

                            match mode.as_str() {
                                "files_with_matches" => {
                                    files_with_matches.push(rel_path_str);
                                }
                                "count" => {
                                    total_matches += regex.find_iter(&content).count();
                                }
                                "content" => {
                                    for (i, line) in content.lines().enumerate() {
                                        if regex.is_match(line) {
                                            content_results.push(GrepContentResult {
                                                file: rel_path_str.clone(),
                                                line: i + 1,
                                                content: line.to_string(),
                                            });
                                            if content_results.len() >= 1000 {
                                                return Ok(GrepResult::Content(content_results));
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        match mode.as_str() {
            "files_with_matches" => Ok(GrepResult::FilesWithMatches(files_with_matches)),
            "count" => Ok(GrepResult::Count(total_matches)),
            _ => Ok(GrepResult::Content(content_results)),
        }
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

#[tauri::command]
pub async fn project_glob(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    path: String,
    pattern: String,
) -> Result<Vec<String>, AppError> {
    let validated_root = get_and_validate_project(&state, &project_id, &path, "read")?;
    tokio::task::spawn_blocking(move || {
        if !validated_root.exists() || !validated_root.is_dir() {
            return Err(AppError::AppPath(format!(
                "Directory does not exist: {}",
                validated_root.display()
            )));
        }

        let mut builder = ignore::overrides::OverrideBuilder::new(&validated_root);
        builder
            .add(&pattern)
            .map_err(|e| AppError::AppPath(format!("Invalid glob pattern: {}", e)))?;
        let overrides = builder
            .build()
            .map_err(|e| AppError::AppPath(format!("Failed to build overrides: {}", e)))?;

        let walker = ignore::WalkBuilder::new(&validated_root)
            .hidden(false)
            .git_ignore(true)
            .overrides(overrides)
            .build();

        let mut results = Vec::new();
        for result in walker {
            if let Ok(entry) = result {
                if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    let rel_path = entry
                        .path()
                        .strip_prefix(&validated_root)
                        .unwrap_or(entry.path());
                    results.push(rel_path.to_string_lossy().into_owned());
                }
            }
        }

        Ok(results)
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

#[tauri::command]
pub async fn create_project_dir(app: AppHandle, name: String) -> Result<String, AppError> {
    let doc_dir = app
        .path()
        .document_dir()
        .map_err(|e| AppError::AppPath(format!("Failed to get document directory: {}", e)))?;

    let safe_name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
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
