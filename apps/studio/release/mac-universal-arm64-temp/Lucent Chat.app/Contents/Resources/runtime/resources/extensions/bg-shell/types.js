/**
 * Shared types, constants, and pattern databases for the bg-shell extension.
 */
// ── Constants ──────────────────────────────────────────────────────────────
export const MAX_BUFFER_LINES = 5000;
export const MAX_EVENTS = 200;
export const DEAD_PROCESS_TTL = 10 * 60 * 1000;
export const PORT_PROBE_TIMEOUT = 500;
export const READY_POLL_INTERVAL = 250;
export const DEFAULT_READY_TIMEOUT = 30000;
// ── Pattern Databases ──────────────────────────────────────────────────────
/** Patterns that indicate a process is ready/listening */
export const READINESS_PATTERNS = [
    // Node/JS servers
    /listening\s+on\s+(?:port\s+)?(\d+)/i,
    /server\s+(?:is\s+)?(?:running|started|listening)\s+(?:at|on)\s+/i,
    /ready\s+(?:in|on|at)\s+/i,
    /started\s+(?:server\s+)?on\s+/i,
    // Next.js / Vite / etc
    /Local:\s*https?:\/\//i,
    /➜\s+Local:\s*/i,
    /compiled\s+(?:successfully|client\s+and\s+server)/i,
    // Python
    /running\s+on\s+https?:\/\//i,
    /Uvicorn\s+running/i,
    /Development\s+server\s+is\s+running/i,
    // Generic
    /press\s+ctrl[\-+]c\s+to\s+(?:quit|stop)/i,
    /watching\s+for\s+(?:file\s+)?changes/i,
    /build\s+(?:completed|succeeded|finished)/i,
];
/** Patterns that indicate errors */
export const ERROR_PATTERNS = [
    /\berror\b[\s:[\](]/i,
    /\bERROR\b/,
    /\bfailed\b/i,
    /\bFAILED\b/,
    /\bfatal\b/i,
    /\bFATAL\b/,
    /\bexception\b/i,
    /\bpanic\b/i,
    /\bsegmentation\s+fault\b/i,
    /\bsyntax\s*error\b/i,
    /\btype\s*error\b/i,
    /\breference\s*error\b/i,
    /Cannot\s+find\s+module/i,
    /Module\s+not\s+found/i,
    /ENOENT/,
    /EACCES/,
    /EADDRINUSE/,
    /TS\d{4,5}:/, // TypeScript errors
    /E\d{4,5}:/, // Rust errors
    /\[ERROR\]/,
    /✖|✗|❌/, // Common error symbols
];
/** Patterns that indicate warnings */
export const WARNING_PATTERNS = [
    /\bwarning\b[\s:[\](]/i,
    /\bWARN(?:ING)?\b/,
    /\bdeprecated\b/i,
    /\bDEPRECATED\b/,
    /⚠️?/,
    /\[WARN\]/,
];
/** Patterns to extract URLs */
export const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/gi;
/** Patterns to extract port numbers from "listening" messages */
export const PORT_PATTERN = /(?:port|listening\s+on|:)\s*(\d{2,5})\b/gi;
/** Patterns indicating test results */
export const TEST_RESULT_PATTERNS = [
    /(\d+)\s+(?:tests?\s+)?passed/i,
    /(\d+)\s+(?:tests?\s+)?failed/i,
    /Tests?:\s+(\d+)\s+passed/i,
    /(\d+)\s+passing/i,
    /(\d+)\s+failing/i,
    /PASS|FAIL/,
];
/** Patterns indicating build completion */
export const BUILD_COMPLETE_PATTERNS = [
    /build\s+(?:completed|succeeded|finished|done)/i,
    /compiled\s+(?:successfully|with\s+\d+\s+(?:error|warning))/i,
    /✓\s+Built/i,
    /webpack\s+\d+\.\d+/i,
    /bundle\s+(?:is\s+)?ready/i,
];
// ── Compiled union regexes (single-pass alternatives to .some(p => p.test(line))) ──
// Built once at module load — eliminates per-line RegExp construction overhead.
export const ERROR_PATTERN_UNION = new RegExp(ERROR_PATTERNS.map(p => p.source).join("|"), "i");
export const WARNING_PATTERN_UNION = new RegExp(WARNING_PATTERNS.map(p => p.source).join("|"), "i");
export const READINESS_PATTERN_UNION = new RegExp(READINESS_PATTERNS.map(p => p.source).join("|"), "i");
export const BUILD_COMPLETE_PATTERN_UNION = new RegExp(BUILD_COMPLETE_PATTERNS.map(p => p.source).join("|"), "i");
export const TEST_RESULT_PATTERN_UNION = new RegExp(TEST_RESULT_PATTERNS.map(p => p.source).join("|"), "i");
/** PORT_PATTERN compiled once for reuse in analyzeLine (needs exec, so must be re-created per call with /g) */
export const PORT_PATTERN_SOURCE = PORT_PATTERN.source;
