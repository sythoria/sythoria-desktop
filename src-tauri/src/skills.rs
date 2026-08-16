use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

use tauri::Manager;

const MAX_FRONTMATTER_BYTES: u64 = 64 * 1024;
const MAX_SKILL_DOCUMENT_BYTES: u64 = 1024 * 1024;
const MAX_SKILL_RESOURCE_BYTES: u64 = 1024 * 1024;
const MAX_SKILL_RESOURCE_READ_CHARS: usize = 100_000;
const DEFAULT_SKILL_RESOURCE_READ_CHARS: usize = 32_000;
const MAX_SKILL_RESOURCES: usize = 500;
const MAX_SKILL_RESOURCE_DEPTH: usize = 12;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillResourceInfo {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillResourceContent {
    pub path: String,
    pub content: String,
    pub offset: usize,
    pub next_offset: Option<usize>,
    pub total_characters: usize,
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

fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false)
}

fn skill_markdown_path(skill_dir: &Path) -> Option<PathBuf> {
    let standard = skill_dir.join("SKILL.md");
    if is_regular_file(&standard) {
        return Some(standard);
    }

    let uppercase_extension = skill_dir.join("SKILL.MD");
    is_regular_file(&uppercase_extension).then_some(uppercase_extension)
}

fn validate_skill_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        || id == "."
        || id == ".."
        || id.contains("..")
    {
        return Err("Invalid skill ID".to_string());
    }
    Ok(())
}

fn resolve_skill_dir(skills_dir: &Path, id: &str) -> Result<PathBuf, String> {
    validate_skill_id(id)?;
    let root = fs::canonicalize(skills_dir).map_err(|_| format!("Skill '{id}' not found"))?;
    let candidate = skills_dir.join(id);
    let metadata =
        fs::symlink_metadata(&candidate).map_err(|_| format!("Skill '{id}' not found"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("Skill '{id}' not found"));
    }
    let resolved = fs::canonicalize(candidate).map_err(|_| format!("Skill '{id}' not found"))?;
    if !resolved.starts_with(&root) {
        return Err("Skill path escapes the skills directory".to_string());
    }
    Ok(resolved)
}

fn normalized_resource_path(path: &Path) -> Result<String, String> {
    if path.as_os_str().to_string_lossy().contains('\\') {
        return Err("Invalid skill resource path".to_string());
    }
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            _ => return Err("Invalid skill resource path".to_string()),
        }
    }
    if parts.is_empty() || parts.len() > MAX_SKILL_RESOURCE_DEPTH {
        return Err("Invalid skill resource path".to_string());
    }
    Ok(parts.join("/"))
}

fn resolve_skill_resource(
    skills_dir: &Path,
    id: &str,
    resource_path: &str,
) -> Result<(PathBuf, String), String> {
    let skill_dir = resolve_skill_dir(skills_dir, id)?;
    let normalized = normalized_resource_path(Path::new(resource_path))?;
    let candidate = skill_dir.join(&normalized);
    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|_| format!("Skill resource '{normalized}' not found"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("Skill resource '{normalized}' not found"));
    }
    let resolved = fs::canonicalize(candidate)
        .map_err(|_| format!("Skill resource '{normalized}' not found"))?;
    if !resolved.starts_with(&skill_dir) {
        return Err("Skill resource path escapes the skill directory".to_string());
    }
    Ok((resolved, normalized))
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
        let is_directory = entry
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false);
        if !is_directory {
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
    let skill_dir = resolve_skill_dir(skills_dir, id)?;
    let Some(markdown_path) = skill_markdown_path(&skill_dir) else {
        return Err(format!("Skill '{id}' not found"));
    };
    let size = fs::metadata(&markdown_path)
        .map_err(|e| e.to_string())?
        .len();
    if size > MAX_SKILL_DOCUMENT_BYTES {
        return Err(format!(
            "Skill '{id}' exceeds the {} byte document limit",
            MAX_SKILL_DOCUMENT_BYTES
        ));
    }
    fs::read_to_string(markdown_path).map_err(|e| e.to_string())
}

fn list_skill_resources_from_dir(
    skills_dir: &Path,
    id: &str,
) -> Result<Vec<SkillResourceInfo>, String> {
    let skill_dir = resolve_skill_dir(skills_dir, id)?;
    let mut directories = VecDeque::from([(skill_dir.clone(), 0usize)]);
    let mut resources = Vec::new();

    while let Some((directory, depth)) = directories.pop_front() {
        let entries = fs::read_dir(&directory).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                if depth >= MAX_SKILL_RESOURCE_DEPTH {
                    return Err(format!(
                        "Skill '{id}' exceeds the maximum resource depth of {MAX_SKILL_RESOURCE_DEPTH}"
                    ));
                }
                directories.push_back((path, depth + 1));
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let relative = path
                .strip_prefix(&skill_dir)
                .map_err(|_| "Skill resource path escapes the skill directory".to_string())?;
            let normalized = normalized_resource_path(relative)?;
            if normalized.eq_ignore_ascii_case("SKILL.md") {
                continue;
            }
            resources.push(SkillResourceInfo {
                path: normalized,
                size: entry.metadata().map_err(|e| e.to_string())?.len(),
            });
            if resources.len() > MAX_SKILL_RESOURCES {
                return Err(format!(
                    "Skill '{id}' exceeds the maximum of {MAX_SKILL_RESOURCES} resources"
                ));
            }
        }
    }

    resources.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(resources)
}

fn read_skill_resource_from_dir(
    skills_dir: &Path,
    id: &str,
    resource_path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<SkillResourceContent, String> {
    let (path, normalized) = resolve_skill_resource(skills_dir, id, resource_path)?;
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_SKILL_RESOURCE_BYTES {
        return Err(format!(
            "Skill resource '{normalized}' exceeds the {} byte limit",
            MAX_SKILL_RESOURCE_BYTES
        ));
    }
    let content = fs::read_to_string(path)
        .map_err(|_| format!("Skill resource '{normalized}' is not UTF-8 text"))?;
    let total_characters = content.chars().count();
    let offset = offset.unwrap_or(0);
    if offset > total_characters {
        return Err(format!(
            "Skill resource offset {offset} exceeds its {total_characters} characters"
        ));
    }
    let limit = limit
        .unwrap_or(DEFAULT_SKILL_RESOURCE_READ_CHARS)
        .clamp(1, MAX_SKILL_RESOURCE_READ_CHARS);
    let chunk: String = content.chars().skip(offset).take(limit).collect();
    let consumed = chunk.chars().count();
    let next = offset + consumed;

    Ok(SkillResourceContent {
        path: normalized,
        content: chunk,
        offset,
        next_offset: (next < total_characters).then_some(next),
        total_characters,
    })
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
    validate_skill_id(&id)?;
    let skills_dir = get_skills_dir(&app);
    tokio::task::spawn_blocking(move || read_skill_from_dir(&skills_dir, &id))
        .await
        .map_err(|e| format!("Skill reader worker failed: {e}"))?
}

#[tauri::command]
pub async fn list_skill_resources(
    app: AppHandle,
    id: String,
) -> Result<Vec<SkillResourceInfo>, String> {
    validate_skill_id(&id)?;
    let skills_dir = get_skills_dir(&app);
    tokio::task::spawn_blocking(move || list_skill_resources_from_dir(&skills_dir, &id))
        .await
        .map_err(|e| format!("Skill resource listing worker failed: {e}"))?
}

#[tauri::command]
pub async fn read_skill_resource(
    app: AppHandle,
    id: String,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<SkillResourceContent, String> {
    validate_skill_id(&id)?;
    let skills_dir = get_skills_dir(&app);
    tokio::task::spawn_blocking(move || {
        read_skill_resource_from_dir(&skills_dir, &id, &path, offset, limit)
    })
    .await
    .map_err(|e| format!("Skill resource reader worker failed: {e}"))?
}

#[tauri::command]
pub async fn create_skill(
    app: AppHandle,
    id: String,
    name: String,
    description: String,
    body: String,
) -> Result<(), String> {
    validate_skill_id(&id)?;
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
    validate_skill_id(&id)?;
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
    validate_skill_id(&id)?;
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

        fn write_resource(&self, id: &str, path: &str, content: &[u8]) {
            let path = self.0.join(id).join(path);
            fs::create_dir_all(path.parent().expect("resource parent"))
                .expect("create resource directory");
            fs::write(path, content).expect("write skill resource");
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

    #[test]
    fn lists_and_reads_bounded_skill_resources() {
        let directory = TestDirectory::new();
        directory.write_skill("example", "SKILL.md", b"---\nname: Example\n---\nBody");
        directory.write_resource("example", "references/guide.md", "AéBC".as_bytes());
        directory.write_resource("example", "scripts/helper.sh", b"echo safe");

        assert_eq!(
            list_skill_resources_from_dir(directory.path(), "example").expect("list resources"),
            vec![
                SkillResourceInfo {
                    path: "references/guide.md".to_string(),
                    size: 5,
                },
                SkillResourceInfo {
                    path: "scripts/helper.sh".to_string(),
                    size: 9,
                },
            ]
        );

        assert_eq!(
            read_skill_resource_from_dir(
                directory.path(),
                "example",
                "references/guide.md",
                Some(1),
                Some(2),
            )
            .expect("read resource"),
            SkillResourceContent {
                path: "references/guide.md".to_string(),
                content: "éB".to_string(),
                offset: 1,
                next_offset: Some(3),
                total_characters: 4,
            }
        );
    }

    #[test]
    fn rejects_resource_traversal_and_invalid_skill_ids() {
        let directory = TestDirectory::new();
        directory.write_skill("example", "SKILL.md", b"Body");

        assert_eq!(
            read_skill_resource_from_dir(directory.path(), "example", "../outside.md", None, None)
                .unwrap_err(),
            "Invalid skill resource path"
        );
        assert_eq!(
            validate_skill_id("../../escape").unwrap_err(),
            "Invalid skill ID"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_skill_directories_and_resources() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new();
        directory.write_skill("example", "SKILL.md", b"Body");
        let outside = directory.path().join("outside.md");
        fs::write(&outside, "outside").expect("write outside file");
        symlink(&outside, directory.path().join("example/references.md"))
            .expect("create resource symlink");
        symlink(
            directory.path().join("example"),
            directory.path().join("linked-skill"),
        )
        .expect("create skill symlink");

        assert!(read_skill_resource_from_dir(
            directory.path(),
            "example",
            "references.md",
            None,
            None
        )
        .is_err());
        assert!(read_skill_from_dir(directory.path(), "linked-skill").is_err());
        assert!(list_skill_resources_from_dir(directory.path(), "example")
            .expect("list resources")
            .is_empty());
    }
}
