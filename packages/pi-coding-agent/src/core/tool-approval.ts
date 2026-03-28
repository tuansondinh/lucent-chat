export type PermissionMode = "danger-full-access" | "accept-on-edit";

export interface FileChangeApprovalRequest {
	action: "write" | "edit" | "delete" | "move";
	path: string;
	message: string;
}

type FileChangeApprovalHandler = (request: FileChangeApprovalRequest) => Promise<boolean>;

let fileChangeApprovalHandler: FileChangeApprovalHandler | null = null;

/** Pending approval requests awaiting a response from the host (keyed by id). */
const pendingApprovals = new Map<string, { resolve: (approved: boolean) => void }>();

let approvalIdCounter = 0;

export function getPermissionMode(): PermissionMode {
	return process.env.GSD_STUDIO_PERMISSION_MODE === "accept-on-edit"
		? "accept-on-edit"
		: "danger-full-access";
}

export function setFileChangeApprovalHandler(handler: FileChangeApprovalHandler | null): void {
	fileChangeApprovalHandler = handler;
}

/**
 * Register the stdout-based approval handler used in supervised (Studio) mode.
 *
 * Sends `{ type: 'approval_request', id, action, path, message }` on stdout
 * and returns a promise that resolves when the host writes back a matching
 * `{ type: 'approval_response', id, approved }` on stdin.
 */
export function registerStdioApprovalHandler(): void {
	setFileChangeApprovalHandler(async (request: FileChangeApprovalRequest): Promise<boolean> => {
		const id = `apr_${++approvalIdCounter}_${Date.now()}`;

		return new Promise<boolean>((resolve) => {
			pendingApprovals.set(id, { resolve });

			const msg = JSON.stringify({
				type: "approval_request",
				id,
				action: request.action,
				path: request.path,
				message: request.message,
			});
			process.stdout.write(msg + "\n");
		});
	});
}

/**
 * Called by headless-ui.ts when an `approval_response` arrives on stdin.
 * Resolves the matching pending approval promise.
 */
export function resolveApprovalResponse(id: string, approved: boolean): void {
	const pending = pendingApprovals.get(id);
	if (pending) {
		pendingApprovals.delete(id);
		pending.resolve(approved);
	}
}

export async function requestFileChangeApproval(request: FileChangeApprovalRequest): Promise<void> {
	if (getPermissionMode() !== "accept-on-edit") {
		return;
	}

	if (!fileChangeApprovalHandler) {
		throw new Error(`Approval required before ${request.action} on ${request.path}, but no approval handler is configured.`);
	}

	const approved = await fileChangeApprovalHandler(request);
	if (!approved) {
		throw new Error(`User declined ${request.action} for ${request.path}.`);
	}
}
