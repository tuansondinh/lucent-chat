import { execFileSync } from "child_process";
import type { BashSpawnHook } from "./bash.js";

/**
 * Creates a BashSpawnHook that rewrites commands through RTK (Rust Token Killer)
 * before execution, reducing token usage by 60-90% on common dev operations.
 *
 * RTK's `rewrite` subcommand exit codes:
 *   0 = rewrite found → use the rewritten command
 *   1 = no RTK equivalent → pass through unchanged
 *   2 = deny rule matched → pass through unchanged
 *   3 = ask rule matched → pass through unchanged (future: could prompt user)
 *   other / error → pass through unchanged (safe default)
 */
export function createRtkSpawnHook(rtkBinary: string = "rtk"): BashSpawnHook {
	return (context) => {
		try {
			const rewritten = execFileSync(rtkBinary, ["rewrite", context.command], {
				encoding: "utf-8",
				timeout: 2000,
				env: context.env,
			}).trim();
			if (rewritten && rewritten !== context.command) {
				return { ...context, command: rewritten };
			}
			return context;
		} catch {
			// Any non-zero exit or error: pass through unchanged
			return context;
		}
	};
}
