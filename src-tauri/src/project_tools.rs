use crate::AppError;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[tauri::command]
pub async fn project_read(
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<String, AppError> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(AppError::AppPath(format!("File does not exist: {}", path.display())));
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::AppPath(format!("Failed to read file: {}", e)))?;
    
    if offset.is_some() || limit.is_some() {
        let lines: Vec<&str> = content.lines().collect();
        // 1-indexed lines
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
}

#[tauri::command]
pub async fn project_write(path: String, content: String) -> Result<(), AppError> {
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
pub async fn project_bash(
    command: String,
    cwd: String,
    timeout: Option<u64>,
    run_in_background: Option<bool>,
) -> Result<String, AppError> {
    let cwd_path = Path::new(&cwd);
    let run_bg = run_in_background.unwrap_or(false);
    
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", &command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(&command);
        c
    };
    cmd.current_dir(cwd_path);

    if run_bg {
        // Spawn and detach
        cmd.spawn().map_err(|e| AppError::AppPath(format!("Failed to spawn command: {}", e)))?;
        return Ok("Command started in background successfully.".to_string());
    }
    
    // We can't use tokio::time::timeout directly on std::process::Command easily without tokio::process::Command.
    // Instead of completely converting to tokio::process::Command here which requires async refactors,
    // we can either block or just let it run. The task specifies using tokio::time::timeout, so let's use tokio::process::Command.
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
    tcmd.current_dir(cwd_path);

    let output_future = tcmd.output();
    let output = if let Some(t) = timeout {
        match tokio::time::timeout(std::time::Duration::from_millis(t), output_future).await {
            Ok(Ok(out)) => out,
            Ok(Err(e)) => return Err(AppError::AppPath(format!("Failed to execute command: {}", e))),
            Err(_) => return Err(AppError::AppPath(format!("Command timed out after {}ms", t))),
        }
    } else {
        output_future.await.map_err(|e| AppError::AppPath(format!("Failed to execute command: {}", e)))?
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
        result = format!("Command exited with error code: {}\n{}", output.status.code().unwrap_or(-1), result);
    }

    Ok(result)
}

#[tauri::command]
pub async fn project_edit(
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
) -> Result<(), AppError> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(AppError::AppPath(format!("File does not exist: {}", path.display())));
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::AppPath(format!("Failed to read file: {}", e)))?;
    
    let allow_mult = replace_all.unwrap_or(false);
    let count = content.matches(&old_string).count();
    
    if count == 0 {
        return Err(AppError::AppPath("Target content not found in file.".to_string()));
    }
    
    if !allow_mult && count > 1 {
        return Err(AppError::AppPath(format!("Target content found {} times, but replace_all is false.", count)));
    }
    
    let new_content = content.replace(&old_string, &new_string);
    fs::write(&path, new_content)
        .map_err(|e| AppError::AppPath(format!("Failed to write file: {}", e)))
}

#[derive(serde::Deserialize)]
pub struct ReplacementChunk {
    pub target_content: String,
    pub replacement_content: String,
    pub allow_multiple: Option<bool>,
}

#[tauri::command]
pub async fn project_multi_replace_file_content(
    path: String,
    chunks: Vec<ReplacementChunk>,
) -> Result<(), AppError> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(AppError::AppPath(format!("File does not exist: {}", path.display())));
    }
    let mut content = fs::read_to_string(&path)
        .map_err(|e| AppError::AppPath(format!("Failed to read file: {}", e)))?;
    
    for (i, chunk) in chunks.iter().enumerate() {
        let count = content.matches(&chunk.target_content).count();
        let allow_mult = chunk.allow_multiple.unwrap_or(false);
        
        if count == 0 {
            return Err(AppError::AppPath(format!("Target content for chunk {} not found in file.", i)));
        }
        
        if !allow_mult && count > 1 {
            return Err(AppError::AppPath(format!("Target content for chunk {} found {} times, but allow_multiple is false.", i, count)));
        }
        
        content = content.replace(&chunk.target_content, &chunk.replacement_content);
    }
    
    fs::write(&path, content)
        .map_err(|e| AppError::AppPath(format!("Failed to write file: {}", e)))
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
    path: String,
    pattern: String,
    output_mode: Option<String>,
    multiline: Option<bool>,
) -> Result<GrepResult, AppError> {
    use ignore::WalkBuilder;
    use regex::RegexBuilder;
    
    let root = PathBuf::from(&path);
    if !root.exists() || !root.is_dir() {
        return Err(AppError::AppPath(format!("Directory does not exist: {}", root.display())));
    }
    
    let is_multiline = multiline.unwrap_or(false);
    let mode = output_mode.unwrap_or_else(|| "files_with_matches".to_string());
    
    let regex = RegexBuilder::new(&pattern)
        .multi_line(is_multiline)
        .build()
        .map_err(|e| AppError::AppPath(format!("Invalid regex: {}", e)))?;
    
    let mut files_with_matches = Vec::new();
    let mut content_results = Vec::new();
    let mut total_matches = 0;
    
    let walker = WalkBuilder::new(&root)
        .hidden(false)
        .git_ignore(true)
        .build();
        
    for result in walker {
        if let Ok(entry) = result {
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    if regex.is_match(&content) {
                        let rel_path = entry.path().strip_prefix(&root).unwrap_or(entry.path());
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
}

#[tauri::command]
pub async fn project_glob(
    path: String,
    pattern: String,
) -> Result<Vec<String>, AppError> {
    use ignore::WalkBuilder;
    use ignore::overrides::OverrideBuilder;
    
    let root = PathBuf::from(&path);
    if !root.exists() || !root.is_dir() {
        return Err(AppError::AppPath(format!("Directory does not exist: {}", root.display())));
    }
    
    let mut builder = OverrideBuilder::new(&root);
    builder.add(&pattern).map_err(|e| AppError::AppPath(format!("Invalid glob pattern: {}", e)))?;
    let overrides = builder.build().map_err(|e| AppError::AppPath(format!("Failed to build overrides: {}", e)))?;
    
    let walker = WalkBuilder::new(&root)
        .hidden(false)
        .git_ignore(true)
        .overrides(overrides)
        .build();
        
    let mut results = Vec::new();
    for result in walker {
        if let Ok(entry) = result {
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                let rel_path = entry.path().strip_prefix(&root).unwrap_or(entry.path());
                results.push(rel_path.to_string_lossy().into_owned());
            }
        }
    }
    
    Ok(results)
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
