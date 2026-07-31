use serde::Serialize;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use tauri::Manager;

const MAX_FRONTMATTER_BYTES: u64 = 64 * 1024;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

fn get_skills_dir(app: &AppHandle) -> PathBuf {
    if let Ok(home) = app.path().home_dir() {
        home.join(".agents").join("skills")
    } else {
        // Fallback
        PathBuf::from(".agents").join("skills")
    }
}

fn parse_frontmatter<R: BufRead>(mut reader: R) -> io::Result<(String, String)> {
    let mut name = String::new();
    let mut description = String::new();
    let mut line = String::new();
    let mut closed = false;

    if reader.read_line(&mut line)? == 0 || line.trim() != "---" {
        return Ok((name, description));
    }

    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }

        let line = line.trim();
        if line == "---" {
            closed = true;
            break;
        }

        if let Some(value) = line.strip_prefix("name:") {
            name = value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
        } else if let Some(value) = line.strip_prefix("description:") {
            description = value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
        }
    }

    if closed {
        Ok((name, description))
    } else {
        Ok((String::new(), String::new()))
    }
}

fn read_skill_metadata(path: &Path) -> io::Result<(String, String)> {
    let file = File::open(path)?;
    let reader = BufReader::new(file).take(MAX_FRONTMATTER_BYTES);
    parse_frontmatter(reader)
}

fn skill_markdown_path(skill_dir: &Path) -> Option<PathBuf> {
    let standard = skill_dir.join("SKILL.md");
    if standard.is_file() {
        return Some(standard);
    }

    let uppercase_extension = skill_dir.join("SKILL.MD");
    uppercase_extension.is_file().then_some(uppercase_extension)
}

fn collect_skills(skills_dir: &Path) -> Result<Vec<SkillInfo>, String> {
    if !skills_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(skills_dir).map_err(|e| {
        format!(
            "Failed to read skills directory '{}': {e}",
            skills_dir.display()
        )
    })?;
    let mut skills = Vec::new();

    for entry_result in entries {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                log::warn!(
                    "Failed to read an entry in '{}': {error}",
                    skills_dir.display()
                );
                continue;
            }
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let Some(markdown_path) = skill_markdown_path(&path) else {
            continue;
        };
        let id = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        match read_skill_metadata(&markdown_path) {
            Ok((mut name, description)) => {
                if name.is_empty() {
                    name = id.clone();
                }
                skills.push(SkillInfo {
                    id,
                    name,
                    description,
                });
            }
            Err(error) => {
                log::warn!(
                    "Failed to read skill metadata from '{}': {error}",
                    markdown_path.display()
                );
            }
        }
    }

    skills.sort_by_cached_key(|skill| (skill.name.to_lowercase(), skill.id.to_lowercase()));
    Ok(skills)
}

fn read_skill_from_dir(skills_dir: &Path, id: &str) -> Result<String, String> {
    let skill_dir = skills_dir.join(id);
    let Some(markdown_path) = skill_markdown_path(&skill_dir) else {
        return Err(format!("Skill '{id}' not found"));
    };

    fs::read_to_string(markdown_path).map_err(|e| e.to_string())
}

fn build_frontmatter(name: &str, description: &str, body: &str) -> String {
    format!(
        "---\nname: \"{}\"\ndescription: \"{}\"\n---\n{}",
        name,
        description,
        body.trim_start()
    )
}

#[tauri::command]
pub async fn list_skills(app: AppHandle) -> Result<Vec<SkillInfo>, String> {
    let skills_dir = get_skills_dir(&app);
    tokio::task::spawn_blocking(move || collect_skills(&skills_dir))
        .await
        .map_err(|e| format!("Skill listing worker failed: {e}"))?
}

#[tauri::command]
pub async fn read_skill(app: AppHandle, id: String) -> Result<String, String> {
    if id.trim().is_empty()
        || id == "."
        || id == ".."
        || id.contains("..")
        || id.contains('/')
        || id.contains('\\')
    {
        return Err("Invalid skill ID".to_string());
    }
    let skills_dir = get_skills_dir(&app);
    tokio::task::spawn_blocking(move || read_skill_from_dir(&skills_dir, &id))
        .await
        .map_err(|e| format!("Skill reader worker failed: {e}"))?
}

#[tauri::command]
pub async fn create_skill(
    app: AppHandle,
    id: String,
    name: String,
    description: String,
    body: String,
) -> Result<(), String> {
    if id.trim().is_empty()
        || id == "."
        || id == ".."
        || id.contains("..")
        || id.contains('/')
        || id.contains('\\')
    {
        return Err("Invalid skill ID".to_string());
    }
    let skills_dir = get_skills_dir(&app);
    let skill_dir = skills_dir.join(&id);

    if skill_dir.exists() {
        return Err(format!("Skill with id '{}' already exists", id));
    }

    fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {}", e))?;

    let content = build_frontmatter(&name, &description, &body);
    let skill_md_path = skill_dir.join("SKILL.md");

    fs::write(skill_md_path, content).map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn update_skill(
    app: AppHandle,
    id: String,
    name: String,
    description: String,
    body: String,
) -> Result<(), String> {
    if id.trim().is_empty()
        || id == "."
        || id == ".."
        || id.contains("..")
        || id.contains('/')
        || id.contains('\\')
    {
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
    if id.trim().is_empty()
        || id == "."
        || id == ".."
        || id.contains("..")
        || id.contains('/')
        || id.contains('\\')
    {
        return Err("Invalid skill ID".to_string());
    }
    let skills_dir = get_skills_dir(&app);
    let skill_dir = skills_dir.join(&id);

    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", id));
    }

    fs::remove_dir_all(skill_dir)
        .map_err(|e| format!("Failed to delete skill directory: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use uuid::Uuid;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("sythoria-skills-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("create test skills directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn write_skill(&self, id: &str, filename: &str, content: &[u8]) {
            let directory = self.0.join(id);
            fs::create_dir_all(&directory).expect("create test skill directory");
            let mut file = File::create(directory.join(filename)).expect("create test skill");
            file.write_all(content).expect("write test skill");
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn missing_skills_directory_returns_an_empty_list() {
        let path = std::env::temp_dir().join(format!("sythoria-missing-skills-{}", Uuid::new_v4()));
        assert_eq!(
            collect_skills(&path).expect("collect missing directory"),
            Vec::new()
        );
    }

    #[test]
    fn lists_only_metadata_in_deterministic_order_without_reading_the_body() {
        let directory = TestDirectory::new();
        directory.write_skill(
            "zeta",
            "SKILL.md",
            b"---\r\nname: 'Zulu'\r\ndescription: \"Last skill\"\r\n---\r\nbody",
        );
        directory.write_skill(
            "alpha",
            "SKILL.MD",
            b"---\nname: Alpha\ndescription: First skill\n---\n\xff\xfe",
        );
        directory.write_skill("fallback", "SKILL.md", b"No frontmatter\nBody");
        fs::create_dir_all(directory.path().join("ignored")).expect("create ignored directory");

        let skills = collect_skills(directory.path()).expect("collect skills");

        assert_eq!(
            skills,
            vec![
                SkillInfo {
                    id: "alpha".to_string(),
                    name: "Alpha".to_string(),
                    description: "First skill".to_string(),
                },
                SkillInfo {
                    id: "fallback".to_string(),
                    name: "fallback".to_string(),
                    description: String::new(),
                },
                SkillInfo {
                    id: "zeta".to_string(),
                    name: "Zulu".to_string(),
                    description: "Last skill".to_string(),
                },
            ]
        );

        let serialized = serde_json::to_value(&skills[0]).expect("serialize skill metadata");
        assert!(serialized.get("content").is_none());
    }

    #[test]
    fn reads_full_skill_content_only_on_demand() {
        let directory = TestDirectory::new();
        let content = "---\nname: Example\ndescription: Test\n---\nFull body";
        directory.write_skill("example", "SKILL.md", content.as_bytes());

        assert_eq!(
            read_skill_from_dir(directory.path(), "example").expect("read skill"),
            content
        );
        assert_eq!(
            read_skill_from_dir(directory.path(), "missing").unwrap_err(),
            "Skill 'missing' not found"
        );
    }
}
