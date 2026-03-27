/**
 * Universal Config Discovery — tool registry
 *
 * Known AI coding tools with their config directory locations.
 * Based on research of Oh My Pi's discovery system and direct config
 * file inspection of each tool.
 */
export const TOOLS = [
    {
        id: "claude",
        name: "Claude Code",
        userDir: ".claude",
        projectDir: ".claude",
    },
    {
        id: "cursor",
        name: "Cursor",
        userDir: ".cursor",
        projectDir: ".cursor",
    },
    {
        id: "windsurf",
        name: "Windsurf",
        userDir: ".codeium/windsurf",
        projectDir: ".windsurf",
    },
    {
        id: "gemini",
        name: "Gemini CLI",
        userDir: ".gemini",
        projectDir: ".gemini",
    },
    {
        id: "codex",
        name: "OpenAI Codex",
        userDir: ".codex",
        projectDir: ".codex",
    },
    {
        id: "cline",
        name: "Cline",
        userDir: null,
        projectDir: null, // Uses root-level .clinerules (handled specially)
    },
    {
        id: "github-copilot",
        name: "GitHub Copilot",
        userDir: null,
        projectDir: ".github",
    },
    {
        id: "vscode",
        name: "VS Code",
        userDir: null,
        projectDir: ".vscode",
    },
];
