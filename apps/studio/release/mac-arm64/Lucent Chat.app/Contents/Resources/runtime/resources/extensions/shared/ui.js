/**
 * Shared UI design system for GSD/interview TUI components.
 *
 * Centralises all colours, glyphs, spacing, and layout helpers so every
 * screen looks consistent and can be restyled from one place.
 *
 * Usage:
 *
 *   import { makeUI } from "./shared/ui.js";
 *
 *   // Inside ctx.ui.custom((tui, theme, _kb, done) => { ... }):
 *   const ui = makeUI(theme, width);
 *
 *   // Then in render(width):
 *   const ui = makeUI(theme, width);
 *   lines.push(...ui.bar());
 *   lines.push(...ui.header("New Project"));
 *   lines.push(...ui.blank());
 *   lines.push(...ui.question("What do you want to build?"));
 *   lines.push(...ui.optionSelected(1, "Describe it now", "Type what you want."));
 *   lines.push(...ui.optionUnselected(2, "Provide a file", "Point to an existing doc."));
 *   lines.push(...ui.blank());
 *   lines.push(...ui.hints(["↑/↓ to move", "enter to select"]));
 *   lines.push(...ui.bar());
 *
 * Every method returns string[] (one or more lines) so you can spread
 * directly into your lines array. Width is passed once to makeUI so
 * individual methods don't need it.
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@lc/tui";
// ─── Glyphs ───────────────────────────────────────────────────────────────────
// Change these to restyle every cursor, checkbox, and indicator at once.
export const GLYPH = {
    cursor: "›",
    check: "✓",
    checkedBox: "[x]",
    uncheckedBox: "[ ]",
    dotActive: "●",
    dotDone: "●",
    squareFilled: "■",
    squareEmpty: "□",
    separator: "─",
    statusPending: "○",
    statusActive: "●",
    statusDone: "✓",
    statusFailed: "✗",
    statusPaused: "⏸",
    statusWarning: "⚠",
    statusSkipped: "–",
};
export const STATUS_COLOR = {
    pending: "dim",
    active: "accent",
    done: "success",
    failed: "error",
    paused: "warning",
    warning: "warning",
    skipped: "dim",
};
export const STATUS_GLYPH = {
    pending: GLYPH.statusPending,
    active: GLYPH.statusActive,
    done: GLYPH.statusDone,
    failed: GLYPH.statusFailed,
    paused: GLYPH.statusPaused,
    warning: GLYPH.statusWarning,
    skipped: GLYPH.statusSkipped,
};
// ─── Spacing ──────────────────────────────────────────────────────────────────
// All indentation constants in one place.
export const INDENT = {
    /** Standard left margin for all content lines */
    base: "  ",
    /** Option label indent (same as base, kept separate for clarity) */
    option: "  ",
    /** Description line below an option label */
    description: "     ",
    /** Note line below a review answer */
    note: "      ",
    /** Cursor + space (replaces base when cursor is shown) */
    cursor: "› ",
};
/**
 * Create a UI helper bound to the current theme and render width.
 * Call once per render() invocation (width may change between renders).
 */
export function makeUI(theme, width) {
    // ── Internal helpers ───────────────────────────────────────────────────────
    const add = (s) => truncateToWidth(s, width);
    const wrap = (s) => wrapTextWithAnsi(s, width);
    function wrapIndented(s, indent) {
        const indentWidth = visibleWidth(indent);
        const wrapped = wrapTextWithAnsi(s, width - indentWidth);
        for (let i = 1; i < wrapped.length; i++)
            wrapped[i] = indent + wrapped[i];
        return wrapped;
    }
    const bar = theme.fg("accent", GLYPH.separator.repeat(width));
    // ── EditorTheme ────────────────────────────────────────────────────────────
    const editorTheme = {
        borderColor: (s) => theme.fg("accent", s),
        selectList: {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
        },
    };
    // ── UI implementation ──────────────────────────────────────────────────────
    return {
        editorTheme,
        // ── Layout ──────────────────────────────────────────────────────────────
        bar: () => [bar],
        blank: () => [""],
        // ── Text elements ────────────────────────────────────────────────────────
        header: (text) => [add(theme.fg("accent", theme.bold(text)))],
        question: (text) => wrap(theme.fg("text", text)),
        subtitle: (text) => wrap(theme.fg("text", text)),
        meta: (text) => [add(theme.fg("dim", text))],
        hints: (parts) => [add(theme.fg("dim", ` ${parts.join("  |  ")}`))],
        note: (text) => [add(theme.fg("dim", text))],
        answer: (text) => [add(theme.fg("success", text))],
        // ── Single-select options ────────────────────────────────────────────────
        optionSelected: (num, label, description, isCommitted = false) => {
            const marker = isCommitted ? theme.fg("success", ` ${GLYPH.check}`) : "";
            const prefix = `${INDENT.option}${theme.fg("accent", INDENT.cursor)}`;
            return [
                ...wrap(`${prefix}${theme.fg("accent", `${num}. ${label}`)}${marker}`),
                ...wrapIndented(`${INDENT.description}${theme.fg("muted", description)}`, INDENT.description),
            ];
        },
        optionUnselected: (num, label, description, opts = {}) => {
            const { isCommitted = false, isFocusDimmed = false } = opts;
            const marker = isCommitted ? theme.fg("success", ` ${GLYPH.check}`) : "";
            const labelColor = isFocusDimmed ? (isCommitted ? "text" : "dim") : "text";
            const descColor = isFocusDimmed ? (isCommitted ? "muted" : "dim") : "muted";
            return [
                ...wrap(`${INDENT.option}  ${theme.fg(labelColor, `${num}. ${label}`)}${marker}`),
                ...wrapIndented(`${INDENT.description}${theme.fg(descColor, description)}`, INDENT.description),
            ];
        },
        // ── Multi-select options ─────────────────────────────────────────────────
        checkboxSelected: (label, description, isChecked) => {
            const box = isChecked ? theme.fg("success", GLYPH.checkedBox) : theme.fg("dim", GLYPH.uncheckedBox);
            return [
                add(`${INDENT.option}${theme.fg("accent", GLYPH.cursor)} ${box} ${theme.fg("accent", label)}`),
                ...wrapIndented(`${INDENT.description}${theme.fg("muted", description)}`, INDENT.description),
            ];
        },
        checkboxUnselected: (label, description, isChecked, isFocusDimmed = false) => {
            const box = isChecked ? theme.fg("success", GLYPH.checkedBox) : theme.fg("dim", GLYPH.uncheckedBox);
            const labelColor = isFocusDimmed ? (isChecked ? "text" : "dim") : "text";
            const descColor = isFocusDimmed ? (isChecked ? "muted" : "dim") : "muted";
            return [
                add(`${INDENT.option}  ${box} ${theme.fg(labelColor, label)}`),
                ...wrapIndented(`${INDENT.description}${theme.fg(descColor, description)}`, INDENT.description),
            ];
        },
        // ── Special slots ────────────────────────────────────────────────────────
        slotSelected: (label, description, isCommitted = false) => {
            const marker = isCommitted ? theme.fg("success", ` ${GLYPH.check}`) : "";
            return [
                ...wrap(`${INDENT.option}${theme.fg("accent", `${GLYPH.cursor}${label}`)}${marker}`),
                ...wrapIndented(`${INDENT.description}${theme.fg("muted", description)}`, INDENT.description),
            ];
        },
        slotUnselected: (label, description, opts = {}) => {
            const { isCommitted = false, isFocusDimmed = false } = opts;
            const marker = isCommitted ? theme.fg("success", ` ${GLYPH.check}`) : "";
            const labelColor = isFocusDimmed ? "dim" : "text";
            const descColor = isFocusDimmed ? "dim" : "muted";
            return [
                ...wrap(`${INDENT.option}  ${theme.fg(labelColor, label)}${marker}`),
                ...wrapIndented(`${INDENT.description}${theme.fg(descColor, description)}`, INDENT.description),
            ];
        },
        doneSelected: () => [
            add(`${INDENT.option}${theme.fg("accent", INDENT.cursor)}${theme.bold(theme.fg("accent", "Done"))}`),
        ],
        doneUnselected: () => [
            add(theme.fg("dim", `${INDENT.option}  Done`)),
        ],
        // ── Action items ─────────────────────────────────────────────────────────
        actionSelected: (num, label, description, tag) => {
            const tagStr = tag ? theme.fg("dim", `  ${tag}`) : "";
            const lines = [add(`${INDENT.option}${theme.fg("accent", GLYPH.cursor)} ${theme.fg("accent", `${num}. ${label}`)}${tagStr}`)];
            if (description)
                lines.push(...wrap(`${INDENT.description}${theme.fg("muted", description)}`));
            return lines;
        },
        actionUnselected: (num, label, description, tag) => {
            const tagStr = tag ? theme.fg("dim", `  ${tag}`) : "";
            const lines = [add(`${INDENT.option}     ${theme.fg("text", `${num}. ${label}`)}${tagStr}`)];
            if (description)
                lines.push(...wrap(`${INDENT.description}${theme.fg("dim", description)}`));
            return lines;
        },
        actionDim: (num, label, description) => {
            const lines = [add(`${INDENT.option}     ${theme.fg("dim", `${num}. ${label}`)}`)];
            if (description)
                lines.push(...wrap(`${INDENT.description}${theme.fg("dim", description)}`));
            return lines;
        },
        // ── Progress indicators ───────────────────────────────────────────────────
        pageDots: (total, currentIndex) => {
            const dots = Array.from({ length: total }, (_, i) => i === currentIndex
                ? theme.fg("accent", GLYPH.dotActive)
                : i < currentIndex
                    ? theme.fg("success", GLYPH.dotDone)
                    : theme.fg("dim", GLYPH.dotActive)).join(theme.fg("dim", " → "));
            return [add(`${INDENT.base}${dots}`)];
        },
        questionTabs: (headers, currentIndex, answeredIndices) => {
            const parts = headers.map((header, i) => {
                const isCurrent = i === currentIndex;
                const isAnswered = answeredIndices.has(i);
                const label = ` ${isAnswered ? GLYPH.squareFilled : GLYPH.squareEmpty} ${header} `;
                return isCurrent
                    ? theme.bg("selectedBg", theme.fg("text", label))
                    : theme.fg(isAnswered ? "success" : "muted", label);
            });
            return [add(` ← ${parts.join(" ")} →`)];
        },
        // ── Status primitives ──────────────────────────────────────────────────────
        statusGlyph: (status) => theme.fg(STATUS_COLOR[status], STATUS_GLYPH[status]),
        statusBadge: (text, status) => {
            const color = STATUS_COLOR[status];
            return [add(`${INDENT.base}${theme.fg(color, theme.bold(text))}`)];
        },
        progressItem: (label, status, opts = {}) => {
            const glyph = theme.fg(STATUS_COLOR[status], STATUS_GLYPH[status]);
            const labelColor = status === "done" ? "muted" : status === "pending" || status === "skipped" ? "dim" : "text";
            const labelText = opts.emphasized ? theme.bold(theme.fg(labelColor, label)) : theme.fg(labelColor, label);
            const detailText = opts.detail ? `  ${theme.fg("dim", opts.detail)}` : "";
            return [add(`${INDENT.base}${glyph} ${labelText}${detailText}`)];
        },
        progressAnnotation: (text) => [add(`${INDENT.description}${theme.fg("dim", text)}`)],
        // ── Notes area ────────────────────────────────────────────────────────────
        notesLabel: (focused) => [
            add(focused ? theme.fg("accent", " Notes:") : theme.fg("muted", " Notes:")),
        ],
        notesText: (text) => wrapIndented(` ${theme.fg("dim", text)}`, " "),
    };
}
