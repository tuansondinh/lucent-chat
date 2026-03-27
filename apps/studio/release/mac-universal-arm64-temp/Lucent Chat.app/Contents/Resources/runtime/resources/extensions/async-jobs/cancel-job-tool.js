/**
 * cancel_job tool — cancel a running background job.
 */
import { Type } from "@sinclair/typebox";
const schema = Type.Object({
    job_id: Type.String({ description: "The background job ID to cancel (e.g. bg_a1b2c3d4)" }),
});
export function createCancelJobTool(getManager) {
    return {
        name: "cancel_job",
        label: "Cancel Background Job",
        description: "Cancel a running background job by its ID.",
        parameters: schema,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            const manager = getManager();
            const result = manager.cancel(params.job_id);
            const messages = {
                cancelled: `Job ${params.job_id} has been cancelled.`,
                not_found: `Job ${params.job_id} not found.`,
                already_completed: `Job ${params.job_id} has already completed (or failed/cancelled).`,
            };
            return {
                content: [{ type: "text", text: messages[result] ?? `Unknown result: ${result}` }],
                details: undefined,
            };
        },
    };
}
