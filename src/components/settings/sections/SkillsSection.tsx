import { useState, useEffect } from "react";
import { Plus, Trash2, Pencil, Save, X } from "lucide-react";
import { ConfirmModal } from "../../ui/Modal";
import { useSkillStore } from "../../../store/useSkillStore";
import { SkillInfo } from "../../../types";
import { useTranslation } from "../../../utils/i18n";
import { motion } from "motion/react";
import { springs, motionTokens } from "../../../lib/motion-tokens";

export function SkillsSection() {
  const { t } = useTranslation();
  const skills = useSkillStore((s) => s.skills);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const createSkill = useSkillStore((s) => s.createSkill);
  const updateSkill = useSkillStore((s) => s.updateSkill);
  const deleteSkill = useSkillStore((s) => s.deleteSkill);
  const loading = useSkillStore((s) => s.loading);

  const [editingSkill, setEditingSkill] = useState<SkillInfo | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formContent, setFormContent] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [skillToDelete, setSkillToDelete] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleEdit = (skill: SkillInfo) => {
    setEditingSkill(skill);
    setIsCreating(false);
    setFormId(skill.id);
    setFormName(skill.name);
    setFormDesc(skill.description);

    // Remove frontmatter from the editor if possible for cleaner editing,
    // but the backend `update_skill` requires the body. Our backend `build_frontmatter`
    // will re-attach frontmatter. So we should pass the raw body.
    // A simple regex to strip frontmatter for editing:
    const contentWithoutFrontmatter = skill.content.replace(/^---\n[\s\S]*?\n---\n/, "");
    setFormContent(contentWithoutFrontmatter);
    setErrorMsg("");
  };

  const handleCreateNew = () => {
    setIsCreating(true);
    setEditingSkill(null);
    setFormId("");
    setFormName("");
    setFormDesc("");
    setFormContent("");
    setErrorMsg("");
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingSkill(null);
    setErrorMsg("");
  };

  const handleSave = async () => {
    if (!formId.trim()) {
      setErrorMsg(t("settings.skills.errIdRequired") || "ID (Folder Name) is required.");
      return;
    }
    if (!formName.trim()) {
      setErrorMsg(t("settings.skills.errNameRequired") || "Skill Name is required.");
      return;
    }

    try {
      if (isCreating) {
        await createSkill(formId, formName, formDesc, formContent);
      } else if (editingSkill) {
        // If ID changed during edit, we would need a rename function in backend.
        // For simplicity, we disable ID editing when updating.
        await updateSkill(formId, formName, formDesc, formContent);
      }
      handleCancel();
    } catch (e: any) {
      setErrorMsg(e.toString());
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSkill(id);
      if (editingSkill?.id === id) {
        handleCancel();
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setSkillToDelete(null);
    }
  };

  if (isCreating || editingSkill) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-text-primary mb-1">
            {isCreating
              ? t("settings.skills.createNew") || "Create New Skill"
              : t("settings.skills.edit") || "Edit Skill"}
          </h2>
          <p className="text-sm text-text-muted">
            {t("settings.skills.description") ||
              "Skills are markdown files containing instructions that agents can read to learn how to do specific tasks."}
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">{errorMsg}</div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-secondary">
              {t("settings.skills.idLabel") || "Folder Name (ID)"}
            </label>
            <input
              type="text"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              disabled={!isCreating}
              placeholder={t("settings.skills.idPlaceholder") || "e.g. react-best-practices"}
              className="w-full px-3 py-2 bg-input border border-input-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
            />
            {isCreating && (
              <p className="text-xs text-text-muted">
                {t("settings.skills.idHelper") || "This will be the folder name in ~/.agents/skills/"}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-secondary">
              {t("settings.skills.nameLabel") || "Skill Name"}
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={t("settings.skills.namePlaceholder") || "e.g. React Best Practices"}
              className="w-full px-3 py-2 bg-input border border-input-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-secondary">
              {t("settings.skills.descLabel") || "Description"}
            </label>
            <input
              type="text"
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              placeholder={t("settings.skills.descPlaceholder") || "Short description of what the skill teaches"}
              className="w-full px-3 py-2 bg-input border border-input-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-secondary">
              {t("settings.skills.contentLabel") || "Markdown Content"}
            </label>
            <textarea
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder={t("settings.skills.contentPlaceholder") || "Write the instructions here..."}
              className="w-full h-64 px-3 py-2 bg-input border border-input-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors resize-y font-mono text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4">
          <motion.button
            onClick={handleSave}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent-hover transition-colors font-medium min-h-[40px]"
          >
            <Save size={16} />
            {t("settings.skills.save") || "Save Skill"}
          </motion.button>
          <motion.button
            onClick={handleCancel}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-2 px-4 py-2 bg-transparent text-text-secondary hover:text-text-primary hover:bg-hover rounded-lg transition-colors font-medium min-h-[40px] border border-border"
          >
            <X size={16} />
            {t("settings.skills.cancel") || "Cancel"}
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-1">
            {t("settings.skills.title") || "Agent Skills"}
          </h3>
          <p className="text-xs text-text-muted">
            {t("settings.skills.subtitle") ||
              "Manage custom skills that provide instructions and context to your AI agents."}
          </p>
        </div>
        <motion.button
          onClick={handleCreateNew}
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
          transition={springs.snappy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
          aria-label={t("settings.skills.newSkill") || "New Skill"}
        >
          <Plus size={14} />
          <span>{t("settings.skills.newSkill") || "New Skill"}</span>
        </motion.button>
      </div>

      <div className="space-y-4">
        {loading && skills.length === 0 ? (
          <div className="text-sm text-text-muted">{t("settings.skills.loading") || "Loading skills..."}</div>
        ) : skills.length === 0 ? (
          <div className="text-center py-8 bg-surface border border-border border-dashed rounded-xl">
            <p className="text-text-muted text-sm">{t("settings.skills.noSkills") || "No skills found"}</p>
            <p className="text-text-muted text-xs mt-1">
              {t("settings.skills.noSkillsDesc") ||
                "Create a skill to provide specialized instructions, examples, and knowledge to your AI agents."}
            </p>
          </div>
        ) : (
          skills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center justify-between p-4 rounded-xl border border-border bg-card/50 hover:bg-hover transition-colors group"
            >
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary">{skill.name}</span>
                  <span className="text-xs text-text-muted font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5">
                    {skill.id}
                  </span>
                </div>
                <span className="text-sm text-text-muted truncate mt-0.5">{skill.description}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <motion.button
                  onClick={() => handleEdit(skill)}
                  whileHover={{ scale: motionTokens.scale.pop }}
                  whileTap={{ scale: motionTokens.scale.press }}
                  transition={springs.snappy}
                  className="p-1.5 text-text-muted hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                  title={t("settings.skills.edit") || "Edit Skill"}
                >
                  <Pencil size={15} />
                </motion.button>
                <motion.button
                  onClick={() => setSkillToDelete(skill.id)}
                  whileHover={{ scale: motionTokens.scale.pop }}
                  whileTap={{ scale: motionTokens.scale.press }}
                  transition={springs.snappy}
                  className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                  title={t("common.delete") || "Delete"}
                >
                  <Trash2 size={15} />
                </motion.button>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal
        isOpen={!!skillToDelete}
        onCancel={() => setSkillToDelete(null)}
        onConfirm={() => skillToDelete && handleDelete(skillToDelete)}
        title={t("settings.skills.deleteTitle", { defaultValue: "Delete Skill" })}
        message={
          t("settings.skills.deleteConfirm", {
            defaultValue: "Are you sure you want to delete this skill? This action cannot be undone.",
          }) + (skillToDelete ? `\n\nSkill ID: ${skillToDelete}` : "")
        }
        confirmText={t("common.delete", { defaultValue: "Delete" })}
        variant="danger"
      />
    </>
  );
}
