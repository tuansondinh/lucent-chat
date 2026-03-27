/**
 * MCP Client Extension — Native MCP server integration for pi
 *
 * Provides on-demand access to MCP servers configured in project files
 * (.mcp.json, .gsd/mcp.json) using the @modelcontextprotocol/sdk Client
 * directly — no external CLI dependency required.
 *
 * Three tools:
 *   mcp_servers   — List available MCP servers from config files
 *   mcp_discover  — Get tool signatures for a specific server (lazy connect)
 *   mcp_call      — Call a tool on an MCP server (lazy connect)
 */
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, } from "@lc/runtime";
import { Text } from "@lc/tui";
import { Type } from "@sinclair/typebox";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
// ─── Connection Manager ───────────────────────────────────────────────────────
const connections = new Map();
let configCache = null;
const toolCache = new Map();
function readConfigs() {
    if (configCache)
        return configCache;
    const servers = [];
    const seen = new Set();
    const configPaths = [
        join(process.cwd(), ".mcp.json"),
        join(process.cwd(), ".gsd", "mcp.json"),
    ];
    for (const configPath of configPaths) {
        try {
            if (!existsSync(configPath))
                continue;
            const raw = readFileSync(configPath, "utf-8");
            const data = JSON.parse(raw);
            const mcpServers = (data.mcpServers ?? data.servers);
            if (!mcpServers || typeof mcpServers !== "object")
                continue;
            for (const [name, config] of Object.entries(mcpServers)) {
                if (seen.has(name))
                    continue;
                seen.add(name);
                const hasCommand = typeof config.command === "string";
                const hasUrl = typeof config.url === "string";
                const transport = hasCommand
                    ? "stdio"
                    : hasUrl
                        ? "http"
                        : "unknown";
                servers.push({
                    name,
                    transport,
                    ...(hasCommand && {
                        command: config.command,
                        args: Array.isArray(config.args) ? config.args : undefined,
                        env: config.env && typeof config.env === "object"
                            ? config.env
                            : undefined,
                        cwd: typeof config.cwd === "string" ? config.cwd : undefined,
                    }),
                    ...(hasUrl && { url: config.url }),
                });
            }
        }
        catch {
            // Non-fatal — config file may not exist or be malformed
        }
    }
    configCache = servers;
    return servers;
}
function getServerConfig(name) {
    return readConfigs().find((s) => s.name === name);
}
/** Resolve ${VAR} references in env values against process.env. */
function resolveEnv(env) {
    const resolved = {};
    for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") {
            resolved[key] = value.replace(/\$\{([^}]+)\}/g, (_match, varName) => process.env[varName] ?? "");
        }
        else {
            resolved[key] = value;
        }
    }
    return resolved;
}
async function getOrConnect(name, signal) {
    const existing = connections.get(name);
    if (existing)
        return existing.client;
    const config = getServerConfig(name);
    if (!config)
        throw new Error(`Unknown MCP server: "${name}". Use mcp_servers to list available servers.`);
    const client = new Client({ name: "gsd", version: "1.0.0" });
    let transport;
    if (config.transport === "stdio" && config.command) {
        transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env ? { ...process.env, ...resolveEnv(config.env) } : undefined,
            cwd: config.cwd,
            stderr: "pipe",
        });
    }
    else if (config.transport === "http" && config.url) {
        transport = new StreamableHTTPClientTransport(new URL(config.url));
    }
    else {
        throw new Error(`Server "${name}" has unsupported transport: ${config.transport}`);
    }
    await client.connect(transport, { signal, timeout: 30000 });
    connections.set(name, { client, transport });
    return client;
}
async function closeAll() {
    const closing = Array.from(connections.entries()).map(async ([name, conn]) => {
        try {
            await conn.client.close();
        }
        catch {
            // Best-effort cleanup
        }
        connections.delete(name);
    });
    await Promise.allSettled(closing);
    toolCache.clear();
}
// ─── Formatters ───────────────────────────────────────────────────────────────
function formatServerList(servers) {
    if (servers.length === 0)
        return "No MCP servers configured. Add servers to .mcp.json or .gsd/mcp.json.";
    const lines = [`${servers.length} MCP servers configured:\n`];
    for (const s of servers) {
        const connected = connections.has(s.name) ? "✓" : "○";
        const cached = toolCache.get(s.name);
        const toolCount = cached ? ` — ${cached.length} tools` : "";
        lines.push(`${connected} ${s.name} (${s.transport})${toolCount}`);
    }
    lines.push("\nUse mcp_discover to see full tool schemas for a specific server.");
    lines.push("Use mcp_call to invoke a tool: mcp_call(server, tool, args).");
    return lines.join("\n");
}
function formatToolList(serverName, tools) {
    const lines = [`${serverName} — ${tools.length} tools:\n`];
    for (const tool of tools) {
        lines.push(`## ${tool.name}`);
        if (tool.description)
            lines.push(tool.description);
        if (tool.inputSchema) {
            lines.push("```json");
            lines.push(JSON.stringify(tool.inputSchema, null, 2));
            lines.push("```");
        }
        lines.push("");
    }
    lines.push(`Call with: mcp_call(server="${serverName}", tool="<tool_name>", args={...})`);
    return lines.join("\n");
}
// ─── Extension ────────────────────────────────────────────────────────────────
export default function (pi) {
    // ── mcp_servers ──────────────────────────────────────────────────────────
    pi.registerTool({
        name: "mcp_servers",
        label: "MCP Servers",
        description: "List all available MCP servers configured in project files (.mcp.json, .gsd/mcp.json). " +
            "Shows server names, transport type, and connection status. Use mcp_discover to get full tool schemas for a server.",
        promptSnippet: "List available MCP servers from project configuration",
        promptGuidelines: [
            "Call mcp_servers to see what MCP servers are available before trying to use one.",
            "MCP servers provide external integrations (Twitter, Linear, Railway, etc.) via the Model Context Protocol.",
            "After listing, use mcp_discover(server) to get tool schemas, then mcp_call(server, tool, args) to invoke.",
        ],
        parameters: Type.Object({
            refresh: Type.Optional(Type.Boolean({ description: "Force refresh the server list (default: use cache)" })),
        }),
        async execute(_id, params) {
            if (params.refresh)
                configCache = null;
            const servers = readConfigs();
            return {
                content: [{ type: "text", text: formatServerList(servers) }],
                details: {
                    serverCount: servers.length,
                    cached: !params.refresh && configCache !== null,
                },
            };
        },
        renderCall(args, theme) {
            let text = theme.fg("toolTitle", theme.bold("mcp_servers"));
            if (args.refresh)
                text += theme.fg("warning", " (refresh)");
            return new Text(text, 0, 0);
        },
        renderResult(result, { isPartial }, theme) {
            if (isPartial)
                return new Text(theme.fg("warning", "Reading MCP config..."), 0, 0);
            const d = result.details;
            return new Text(theme.fg("success", `${d?.serverCount ?? 0} servers configured`), 0, 0);
        },
    });
    // ── mcp_discover ─────────────────────────────────────────────────────────
    pi.registerTool({
        name: "mcp_discover",
        label: "MCP Discover",
        description: "Get detailed tool signatures and JSON schemas for a specific MCP server. " +
            "Connects to the server on first call (lazy connection). " +
            "Use this to understand what tools a server provides and what arguments they accept " +
            "before calling them with mcp_call.",
        promptSnippet: "Get tool schemas for a specific MCP server before calling its tools",
        promptGuidelines: [
            "Call mcp_discover with a server name to see the full tool signatures before calling mcp_call.",
            "The schemas show required and optional parameters with types and descriptions.",
        ],
        parameters: Type.Object({
            server: Type.String({
                description: "MCP server name (from mcp_servers output), e.g. 'railway', 'twitter-mcp', 'linear'",
            }),
        }),
        async execute(_id, params, signal) {
            try {
                // Return cached tools if available
                const cached = toolCache.get(params.server);
                if (cached) {
                    const text = formatToolList(params.server, cached);
                    const truncation = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
                    let finalText = truncation.content;
                    if (truncation.truncated) {
                        finalText += `\n\n[Truncated: ${truncation.outputLines}/${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
                    }
                    return {
                        content: [{ type: "text", text: finalText }],
                        details: { server: params.server, toolCount: cached.length, cached: true },
                    };
                }
                const client = await getOrConnect(params.server, signal);
                const result = await client.listTools(undefined, { signal, timeout: 30000 });
                const tools = (result.tools ?? []).map((t) => ({
                    name: t.name,
                    description: t.description ?? "",
                    inputSchema: t.inputSchema,
                }));
                toolCache.set(params.server, tools);
                const text = formatToolList(params.server, tools);
                const truncation = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
                let finalText = truncation.content;
                if (truncation.truncated) {
                    finalText += `\n\n[Truncated: ${truncation.outputLines}/${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
                }
                return {
                    content: [{ type: "text", text: finalText }],
                    details: { server: params.server, toolCount: tools.length, cached: false },
                };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                throw new Error(`Failed to discover tools for "${params.server}": ${msg}`);
            }
        },
        renderCall(args, theme) {
            let text = theme.fg("toolTitle", theme.bold("mcp_discover "));
            text += theme.fg("accent", args.server);
            return new Text(text, 0, 0);
        },
        renderResult(result, { isPartial }, theme) {
            if (isPartial)
                return new Text(theme.fg("warning", "Discovering tools..."), 0, 0);
            const d = result.details;
            return new Text(theme.fg("success", `${d?.toolCount ?? 0} tools`) +
                theme.fg("dim", ` · ${d?.server}`), 0, 0);
        },
    });
    // ── mcp_call ─────────────────────────────────────────────────────────────
    pi.registerTool({
        name: "mcp_call",
        label: "MCP Call",
        description: "Call a tool on an MCP server. Provide the server name, tool name, and arguments. " +
            "Connects to the server on first call (lazy connection). " +
            "Use mcp_discover first to see available tools and their required arguments.",
        promptSnippet: "Call a tool on an MCP server",
        promptGuidelines: [
            "Always use mcp_discover first to understand the tool's parameters before calling mcp_call.",
            "Arguments are passed as a JSON object matching the tool's input schema.",
        ],
        parameters: Type.Object({
            server: Type.String({
                description: "MCP server name, e.g. 'railway', 'twitter-mcp'",
            }),
            tool: Type.String({
                description: "Tool name on that server, e.g. 'railway_list_projects'",
            }),
            args: Type.Optional(Type.Object({}, {
                additionalProperties: true,
                description: "Tool arguments as key-value pairs matching the tool's input schema",
            })),
        }),
        async execute(_id, params, signal) {
            try {
                const client = await getOrConnect(params.server, signal);
                const result = await client.callTool({ name: params.tool, arguments: params.args ?? {} }, undefined, { signal, timeout: 60000 });
                // Serialize result content to text
                const contentItems = result.content;
                const raw = contentItems
                    .map((c) => (c.type === "text" ? c.text ?? "" : JSON.stringify(c)))
                    .join("\n");
                const truncation = truncateHead(raw, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
                let finalText = truncation.content;
                if (truncation.truncated) {
                    finalText += `\n\n[Output truncated: ${truncation.outputLines}/${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
                }
                return {
                    content: [{ type: "text", text: finalText }],
                    details: {
                        server: params.server,
                        tool: params.tool,
                        charCount: finalText.length,
                        truncated: truncation.truncated,
                    },
                };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                throw new Error(`MCP call failed: ${params.server}.${params.tool}\n${msg}`);
            }
        },
        renderCall(args, theme) {
            let text = theme.fg("toolTitle", theme.bold("mcp_call "));
            text += theme.fg("accent", `${args.server}.${args.tool}`);
            if (args.args && Object.keys(args.args).length > 0) {
                const preview = Object.entries(args.args)
                    .slice(0, 3)
                    .map(([k, v]) => {
                    const val = typeof v === "string" ? v : JSON.stringify(v);
                    return `${k}:${val.length > 30 ? val.slice(0, 30) + "…" : val}`;
                })
                    .join(" ");
                text += " " + theme.fg("muted", preview);
            }
            return new Text(text, 0, 0);
        },
        renderResult(result, { isPartial, expanded }, theme) {
            if (isPartial)
                return new Text(theme.fg("warning", "Calling MCP tool..."), 0, 0);
            const d = result.details;
            let text = theme.fg("success", `✓ ${d?.server}.${d?.tool}`);
            text += theme.fg("dim", ` · ${(d?.charCount ?? 0).toLocaleString()} chars`);
            if (d?.truncated)
                text += theme.fg("warning", " · truncated");
            if (expanded) {
                const content = result.content[0];
                if (content?.type === "text") {
                    const preview = content.text.split("\n").slice(0, 15).join("\n");
                    text += "\n\n" + theme.fg("dim", preview);
                }
            }
            return new Text(text, 0, 0);
        },
    });
    // ── Lifecycle ─────────────────────────────────────────────────────────────
    pi.on("session_start", async (_event, ctx) => {
        const servers = readConfigs();
        if (servers.length > 0) {
            ctx.ui.notify(`MCP client ready — ${servers.length} server(s) configured`, "info");
        }
    });
    pi.on("session_shutdown", async () => {
        await closeAll();
    });
    pi.on("session_switch", async () => {
        await closeAll();
        configCache = null;
    });
}
