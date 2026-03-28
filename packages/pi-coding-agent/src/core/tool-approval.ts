export type PermissionMode = "danger-full-access" | "accept-on-edit";

export interface FileChangeApprovalRequest {
	action: "write" | "edit" | "delete" | "move";
	path: string;
	message: string;
}

type FileChangeApprovalHandler = (request: FileChangeApprovalRequest) => Promise<boolean>;

let fileChangeApprovalHandler: FileChangeApprovalHandler | null = null;

export function getPermissionMode(): PermissionMode {
	return process.env.GSD_STUDIO_PERMISSION_MODE === "accept-on-edit"
		? "accept-on-edit"
		: "danger-full-access";
}

export function setFileChangeApprovalHandler(handler: FileChangeApprovalHandler | null): void {
	fileChangeApprovalHandler = handler;
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
