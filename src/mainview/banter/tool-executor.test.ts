import { beforeEach, describe, expect, test } from "bun:test";
import { streamOverlays } from "../streaming/stream-overlays";
import { agentActionQueue } from "./action-queue";
import { executeQueuedToolAction, executeToolCalls, type ToolExecutionPolicy, type ToolResult } from "./tool-executor";

const SUGGESTED_POLICY: ToolExecutionPolicy = {
	participantId: null,
	agentName: "Director",
	autonomyLevel: "suggested",
	permissions: { controlOverlays: true, controlMusic: true },
};

describe("tool execution policy", () => {
	beforeEach(() => {
		agentActionQueue.clear();
		streamOverlays.clear();
	});

	test("queues medium-risk actions in suggested mode", async () => {
		const results = await executeToolCalls([
			{ id: "tc-1", name: "show_overlay", args: { kind: "notice", body: "hello" } },
		], SUGGESTED_POLICY);

		const parsed = parseOutput(results);
		expect(parsed["suggested"]).toBe(true);
		expect(agentActionQueue.pending()).toHaveLength(1);
		expect(streamOverlays.all()).toHaveLength(0);
	});

	test("denies disabled tool families before queuing", async () => {
		const results = await executeToolCalls([
			{ id: "tc-2", name: "show_overlay", args: { kind: "notice", body: "hello" } },
		], {
			...SUGGESTED_POLICY,
			permissions: { controlOverlays: false, controlMusic: true },
		});

		const parsed = parseOutput(results);
		expect(String(parsed["error"])).toContain("disabled");
		expect(agentActionQueue.pending()).toHaveLength(0);
	});

	test("approved queued actions execute through the same tool path", async () => {
		const results = await executeToolCalls([
			{ id: "tc-3", name: "show_overlay", args: { kind: "notice", body: "approved" } },
		], SUGGESTED_POLICY);
		const actionId = String(parseOutput(results)["actionId"]);

		await executeQueuedToolAction(actionId);

		expect(agentActionQueue.find(actionId)?.status).toBe("executed");
		expect(streamOverlays.all()).toHaveLength(1);
	});
});

function parseOutput(results: ToolResult[]): Record<string, unknown> {
	return JSON.parse(results[0]?.output ?? "{}") as Record<string, unknown>;
}

