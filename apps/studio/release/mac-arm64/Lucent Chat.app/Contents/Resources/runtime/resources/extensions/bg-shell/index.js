/**
 * Background Shell Extension v2
 *
 * Command/tool registration is deferred in interactive mode so startup does not
 * block on the full background-process stack before the TUI paints.
 */
import { importExtensionModule } from "@lc/runtime";
import { registerBgShellLifecycle } from "./bg-shell-lifecycle.js";
let featuresPromise = null;
async function registerBgShellFeatures(pi, state) {
    if (!featuresPromise) {
        featuresPromise = (async () => {
            const [{ registerBgShellTool }, { registerBgShellCommand }] = await Promise.all([
                importExtensionModule(import.meta.url, "./bg-shell-tool.js"),
                importExtensionModule(import.meta.url, "./bg-shell-command.js"),
            ]);
            registerBgShellTool(pi, state);
            registerBgShellCommand(pi, state);
        })().catch((error) => {
            featuresPromise = null;
            throw error;
        });
    }
    return featuresPromise;
}
export default function (pi) {
    const state = {
        latestCtx: null,
        refreshWidget: () => { },
    };
    registerBgShellLifecycle(pi, state);
    pi.on("session_start", async (_event, ctx) => {
        if (ctx.hasUI) {
            void registerBgShellFeatures(pi, state).catch((error) => {
                ctx.ui.notify(`bg-shell failed to load: ${error instanceof Error ? error.message : String(error)}`, "warning");
            });
            return;
        }
        await registerBgShellFeatures(pi, state);
    });
}
