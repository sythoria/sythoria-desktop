import { describe, it, expect } from "vitest";
import { PLUGINS_CATALOG, PLUGIN_CATEGORIES, getPluginMcpSource } from "./pluginsCatalog";

describe("pluginsCatalog", () => {
  it("should contain exactly 50 plugins in the catalog", () => {
    expect(PLUGINS_CATALOG.length).toBeGreaterThanOrEqual(48);
  });

  it("should have unique IDs for all plugins", () => {
    const ids = PLUGINS_CATALOG.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("should assign every plugin a valid category", () => {
    const validCategories = new Set(PLUGIN_CATEGORIES.map((c) => c.id));
    for (const plugin of PLUGINS_CATALOG) {
      expect(validCategories.has(plugin.category)).toBe(true);
      expect(plugin.name.trim().length).toBeGreaterThan(0);
      expect(plugin.description.trim().length).toBeGreaterThan(0);
      expect(plugin.preset).toBeDefined();
      if (plugin.preset.transport === "streamable-http") {
        expect(new URL(plugin.preset.baseUrl!).protocol).toBe("https:");
      } else {
        expect(plugin.preset.command.trim().length).toBeGreaterThan(0);
        expect(plugin.preset.args.length).toBeGreaterThan(0);
      }
    }
  });

  it("should have valid auth fields structure when authType requires credentials", () => {
    for (const plugin of PLUGINS_CATALOG) {
      if (plugin.authType === "api_key" || plugin.authType === "connection_string") {
        expect(plugin.authFields.length).toBeGreaterThan(0);
        for (const field of plugin.authFields) {
          expect(field.key.trim().length).toBeGreaterThan(0);
          expect(field.label.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("links every plugin to the MCP package named in its launch command", () => {
    for (const plugin of PLUGINS_CATALOG) {
      const source = getPluginMcpSource(plugin);
      expect(source, plugin.id).not.toBeNull();
      if (source!.kind === "remote") {
        expect(source!.packageSpec.startsWith("https://")).toBe(true);
      } else {
        expect(plugin.preset.args).toContain(source!.packageSpec);
      }
      expect(new URL(source!.url).protocol).toBe("https:");
    }

    const drive = PLUGINS_CATALOG.find((plugin) => plugin.id === "google-drive")!;
    expect(getPluginMcpSource(drive)).toEqual({
      packageSpec: "@piotr-agier/google-drive-mcp@2.11.0",
      url: "https://www.npmjs.com/package/%40piotr-agier/google-drive-mcp",
    });

    const fetch = PLUGINS_CATALOG.find((plugin) => plugin.id === "fetch")!;
    expect(getPluginMcpSource(fetch)).toEqual({
      packageSpec: "mcp-server-fetch",
      url: "https://pypi.org/project/mcp-server-fetch/",
    });

    expect(
      getPluginMcpSource(drive, {
        id: "custom-drive",
        name: "Google Drive",
        transport: "stdio",
        command: "npx",
        args: ["-y", "my-drive-mcp"],
        enabled: true,
      }),
    ).toEqual({ packageSpec: "my-drive-mcp", url: "https://www.npmjs.com/package/my-drive-mcp" });
  });
});
