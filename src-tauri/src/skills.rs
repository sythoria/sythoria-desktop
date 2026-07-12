use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub content: String,
}

fn get_skills_dir(app: &AppHandle) -> PathBuf {
    if let Ok(home) = app.path().home_dir() {
        home.join(".agents").join("skills")
    } else {
        // Fallback
        PathBuf::from(".agents").join("skills")
    }
}

// Parses a simple YAML frontmatter.
fn parse_frontmatter(content: &str) -> (String, String) {
    let mut name = String::new();
    let mut description = String::new();

    if content.starts_with("---") {
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() >= 3 {
            let frontmatter = parts[1];
            for line in frontmatter.lines() {
                let line = line.trim();
                if line.starts_with("name:") {
                    name = line.trim_start_matches("name:").trim().trim_matches('"').trim_matches('\'').to_string();
                } else if line.starts_with("description:") {
                    description = line.trim_start_matches("description:").trim().trim_matches('"').trim_matches('\'').to_string();
                }
            }
        }
    }
    (name, description)
}

fn build_frontmatter(name: &str, description: &str, body: &str) -> String {
    format!("---\nname: \"{}\"\ndescription: \"{}\"\n---\n{}", name, description, body.trim_start())
}

#[tauri::command]
pub async fn list_skills(app: AppHandle) -> Result<Vec<SkillInfo>, String> {
    let skills_dir = get_skills_dir(&app);
    let mut skills = Vec::new();

    if !skills_dir.exists() {
        return Ok(skills);
    }

    let entries = fs::read_dir(skills_dir).map_err(|e| e.to_string())?;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_dir() {
                let skill_md_path = path.join("SKILL.md");
                let skill_md_path_alt = path.join("SKILL.MD"); // Check both cases
                
                let file_to_read = if skill_md_path.exists() {
                    Some(skill_md_path)
                } else if skill_md_path_alt.exists() {
                    Some(skill_md_path_alt)
                } else {
                    None
                };

                if let Some(md_path) = file_to_read {
                    if let Ok(content) = fs::read_to_string(md_path) {
                        let id = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                        let (mut name, description) = parse_frontmatter(&content);
                        if name.is_empty() {
                            name = id.clone();
                        }
                        skills.push(SkillInfo {
                            id,
                            name,
                            description,
                            content,
                        });
                    }
                }
            }
        }
    }
    Ok(skills)
}

#[tauri::command]
pub async fn read_skill(app: AppHandle, id: String) -> Result<String, String> {
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid skill ID".to_string());
    }
    let skills_dir = get_skills_dir(&app);
    let skill_dir = skills_dir.join(&id);
    let skill_md_path = skill_dir.join("SKILL.md");
    let skill_md_path_alt = skill_dir.join("SKILL.MD");
    
    if skill_md_path.exists() {
        fs::read_to_string(skill_md_path).map_err(|e| e.to_string())
    } else if skill_md_path_alt.exists() {
        fs::read_to_string(skill_md_path_alt).map_err(|e| e.to_string())
    } else {
        Err(format!("Skill '{}' not found", id))
    }
}

#[tauri::command]
pub async fn create_skill(app: AppHandle, id: String, name: String, description: String, body: String) -> Result<(), String> {
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid skill ID".to_string());
    }
    let skills_dir = get_skills_dir(&app);
    let skill_dir = skills_dir.join(&id);
    
    if skill_dir.exists() {
        return Err(format!("Skill with id '{}' already exists", id));
    }
    
    fs::create_dir_all(&skill_dir).map_err(|e| format!("Failed to create skill directory: {}", e))?;
    
    let content = build_frontmatter(&name, &description, &body);
    let skill_md_path = skill_dir.join("SKILL.md");
    
    fs::write(skill_md_path, content).map_err(|e| format!("Failed to write SKILL.md: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub async fn update_skill(app: AppHandle, id: String, name: String, description: String, body: String) -> Result<(), String> {
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid skill ID".to_string());
    }
    let skills_dir = get_skills_dir(&app);
    let skill_dir = skills_dir.join(&id);
    
    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", id));
    }
    
    let content = build_frontmatter(&name, &description, &body);
    let skill_md_path = skill_dir.join("SKILL.md");
    
    fs::write(skill_md_path, content).map_err(|e| format!("Failed to write SKILL.md: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub async fn delete_skill(app: AppHandle, id: String) -> Result<(), String> {
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid skill ID".to_string());
    }
    let skills_dir = get_skills_dir(&app);
    let skill_dir = skills_dir.join(&id);
    
    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", id));
    }
    
    fs::remove_dir_all(skill_dir).map_err(|e| format!("Failed to delete skill directory: {}", e))?;
    
    Ok(())
}
