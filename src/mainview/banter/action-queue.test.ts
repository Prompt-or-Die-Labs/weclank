import { beforeEach, describe, expect, test } from "bun:test";
import { agentActionQueue, type QueuedAgentAction } from "./action-queue";
import type { ToolInvocation } from "./tools";

function noticeAction(body: string): Omit<QueuedAgentAction, "id" | "ts" | "status"> {
	const invocation: ToolInvocation = { name: "show_overlay", args: { kind: "notice", body } };
	return {
		participantId: null,
		agentName: "Director",
		invocation,
		risk: "medium",
		reason: "Test action",
	};
}

beforeEach(() => {
	agentActionQueue.clear();
});

describe("agentActionQueue", () => {
	test("add returns a stamped action with status=pending and a unique id", () => {
		const action = agentActionQueue.add(noticeAction("first"));

		expect(action.status).toBe("pending");
		expect(action.id).toMatch(/^act-/);
		expect(typeof action.ts).toBe("number");
		expect(action.reason).toBe("Test action");
		expect(agentActionQueue.all()).toHaveLength(1);
	});

	test("newest action appears first", () => {
		const first = agentActionQueue.add(noticeAction("first"));
		const second = agentActionQueue.add(noticeAction("second"));

		const all = agentActionQueue.all();
		expect(all[0]?.id).toBe(second.id);
		expect(all[1]?.id).toBe(first.id);
	});

	test("capped at 80 entries — older actions fall off the tail", () => {
		for (let i = 0; i < 90; i++) {
			agentActionQueue.add(noticeAction(`msg-${i}`));
		}
		const all = agentActionQueue.all();
		expect(all).toHaveLength(80);
		// The first 10 should have been dropped — the newest 80 survive.
		expect(all[0]?.invocation.name).toBe("show_overlay");
		const bodies = all.map((a) => (a.invocation as { args: { body: string } }).args.body);
		expect(bodies[0]).toBe("msg-89");
		expect(bodies[bodies.length - 1]).toBe("msg-10");
	});

	test("pending() filters out non-pending actions", () => {
		const a = agentActionQueue.add(noticeAction("a"));
		const b = agentActionQueue.add(noticeAction("b"));
		agentActionQueue.mark(a.id, { status: "executed" });

		const pending = agentActionQueue.pending();
		expect(pending).toHaveLength(1);
		expect(pending[0]?.id).toBe(b.id);
	});

	test("mark patches status and error fields", () => {
		const a = agentActionQueue.add(noticeAction("fail-me"));

		agentActionQueue.mark(a.id, { status: "failed", error: "boom" });

		const after = agentActionQueue.find(a.id);
		expect(after?.status).toBe("failed");
		expect(after?.error).toBe("boom");
	});

	test("reject is a shortcut for marking status=rejected", () => {
		const a = agentActionQueue.add(noticeAction("nope"));

		agentActionQueue.reject(a.id);

		expect(agentActionQueue.find(a.id)?.status).toBe("rejected");
	});

	test("clear empties the queue and notifies subscribers", () => {
		agentActionQueue.add(noticeAction("x"));
		agentActionQueue.add(noticeAction("y"));

		let lastSnapshot: QueuedAgentAction[] | null = null;
		const unsub = agentActionQueue.subscribe((snapshot) => { lastSnapshot = snapshot; });
		// initial fire — current state
		expect(lastSnapshot).toHaveLength(2);

		agentActionQueue.clear();

		expect(agentActionQueue.all()).toHaveLength(0);
		expect(lastSnapshot).toHaveLength(0);
		unsub();
	});

	test("subscribe fires immediately with the current snapshot", () => {
		agentActionQueue.add(noticeAction("present"));

		let received: QueuedAgentAction[] | null = null;
		const unsub = agentActionQueue.subscribe((snapshot) => { received = snapshot; });

		expect(received).toHaveLength(1);
		unsub();
	});

	test("unsubscribing stops further notifications", () => {
		let calls = 0;
		const unsub = agentActionQueue.subscribe(() => { calls++; });
		expect(calls).toBe(1); // initial fire

		agentActionQueue.add(noticeAction("counted"));
		expect(calls).toBe(2);

		unsub();
		agentActionQueue.add(noticeAction("not counted"));
		expect(calls).toBe(2);
	});

	test("find returns null for unknown ids", () => {
		expect(agentActionQueue.find("act-unknown")).toBeNull();
	});

	test("mark with unknown id is a no-op (does not throw)", () => {
		expect(() => agentActionQueue.mark("act-unknown", { status: "executed" })).not.toThrow();
		expect(agentActionQueue.all()).toHaveLength(0);
	});
});
