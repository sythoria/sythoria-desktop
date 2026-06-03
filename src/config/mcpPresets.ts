export const MCP_TRANSPORT_PRESETS = [
  {
    label: "Stdio" as const,
    transport: "stdio" as const,
    fields: ["command", "args", "env"] as const,
  },
  {
    label: "SSE" as const,
    transport: "sse" as const,
    fields: ["baseUrl", "apiKey"] as const,
  },
  {
    label: "Streamable HTTP" as const,
    transport: "streamable-http" as const,
    fields: ["baseUrl", "apiKey"] as const,
  },
] as const;
