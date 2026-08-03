import type { Conversation, McpTool, McpToolResult, ModelConfig, Project, SearchApiConfig } from "../types";

export type McpToolCaller = (
  serverId: string,
  toolName: string,
  args: Record<string, string>,
) => Promise<McpToolResult>;

export interface ConversationRunContext {
  readonly conversationId: string;
  readonly modelConfig: ModelConfig;
  readonly temperature: number;
  readonly project: Project | null;
  readonly worktree: Readonly<{ path: string; branch: string }> | null;
  readonly searchConfig: SearchApiConfig | undefined;
  readonly searchApiKey: string;
  readonly mcpTools: McpTool[];
  readonly mcpCallTool: McpToolCaller | undefined;
  readonly attachmentCapabilities: Readonly<{ images: boolean }>;
  readonly commitScope: Readonly<{
    projectId: string | null;
    projectRoot: string | null;
    modelId: string;
    worktreePath: string | null;
    worktreeBranch: string | null;
  }>;
  readonly shouldUseTools: boolean;
}

interface BuildConversationRunContextOptions {
  conversation: Conversation;
  models: ModelConfig[];
  selectedModel: string;
  temperature: number;
  projects: Project[];
  projectsEnabled: boolean;
  searchConfig: SearchApiConfig | undefined;
  searchApiKey: string;
  mcpTools: McpTool[];
  mcpCallTool: McpToolCaller | undefined;
}

function cloneProject(project: Project | null): Project | null {
  if (!project) return null;
  return Object.freeze({
    ...project,
    excludePatterns: project.excludePatterns ? Object.freeze([...project.excludePatterns]) : undefined,
  }) as Project;
}

function cloneMcpTools(tools: McpTool[]): McpTool[] {
  return Object.freeze(
    tools.map((tool) =>
      Object.freeze({
        ...tool,
        inputSchema: Object.freeze({ ...tool.inputSchema }),
      }),
    ),
  ) as unknown as McpTool[];
}

export function buildConversationRunContext(
  options: BuildConversationRunContextOptions,
): ConversationRunContext | undefined {
  const project = cloneProject(
    options.projectsEnabled && options.conversation.projectId
      ? (options.projects.find((candidate) => candidate.id === options.conversation.projectId) ?? null)
      : null,
  );
  const selectedModel =
    options.models.find((model) => model.id === project?.modelOverride && model.enabled !== false) ??
    options.models.find((model) => model.id === options.conversation.model && model.enabled !== false) ??
    options.models.find((model) => model.id === options.selectedModel && model.enabled !== false) ??
    options.models.find((model) => model.enabled !== false);
  if (!selectedModel) return undefined;

  const modelConfig = Object.freeze({ ...selectedModel }) as ModelConfig;
  const worktree = options.conversation.pendingWorktree
    ? Object.freeze({ ...options.conversation.pendingWorktree })
    : null;
  const searchConfig = options.searchConfig
    ? (Object.freeze({ ...options.searchConfig }) as SearchApiConfig)
    : undefined;
  const mcpTools = cloneMcpTools(options.mcpTools);
  const attachmentCapabilities = Object.freeze({ images: modelConfig.supportsImages !== false });
  const commitScope = Object.freeze({
    projectId: project?.id ?? null,
    projectRoot: project?.path ?? null,
    modelId: modelConfig.id,
    worktreePath: worktree?.path ?? null,
    worktreeBranch: worktree?.branch ?? null,
  });

  return Object.freeze({
    conversationId: options.conversation.id,
    modelConfig,
    temperature: options.temperature,
    project,
    worktree,
    searchConfig,
    searchApiKey: options.searchApiKey,
    mcpTools,
    mcpCallTool: options.mcpCallTool,
    attachmentCapabilities,
    commitScope,
    shouldUseTools: Boolean(project || searchConfig || mcpTools.length > 0),
  });
}

export function continueConversationRunContext(
  context: ConversationRunContext,
  conversationId: string,
  worktree: Readonly<{ path: string; branch: string }> | null = context.worktree,
): ConversationRunContext {
  const worktreeSnapshot = worktree ? Object.freeze({ ...worktree }) : null;
  return Object.freeze({
    ...context,
    conversationId,
    worktree: worktreeSnapshot,
    commitScope: Object.freeze({
      ...context.commitScope,
      worktreePath: worktreeSnapshot?.path ?? null,
      worktreeBranch: worktreeSnapshot?.branch ?? null,
    }),
  });
}
