// Smoke tests for the BanterEngine's observability surface. The full
// loop (LLM → tool execution → TTS) needs network + audio and lives in
// integration testing; here we just confirm:
//   - getPhase / getToolCallLog return safe defaults for unknown sessions
//   - getPhase doesn't throw before start()
//
// The session lifecycle is exercised indirectly: start() / stop() are
// no-ops when config.enabled is false, and we rely on isRunning() to
// short-circuit the rest.

import { describe, expect, test } from "bun:test";
import { banterEngine } from "./banter-engine";
import { participantId } from "../core/ids";
import type { BanterConfig } from "../core/types";

const DISABLED_CONFIG: BanterConfig = {
	enabled: false,
	twitchChannel: "",
	llmProvider: "openrouter",
	llmModel: "openrouter/free",
	systemPrompt: "test",
	voiceActivityGate: true,
	proactiveOnTranscript: false,
};

describe("banterEngine observability", () => {
	test("getPhase returns 'idle' for unknown participants", () => {
		expect(banterEngine.getPhase(participantId("nobody"))).toBe("idle");
	});

	test("getToolCallLog returns [] for unknown participants", () => {
		expect(banterEngine.getToolCallLog(participantId("nobody"))).toEqual([]);
	});

	test("start with enabled:false is a no-op (no session registered)", () => {
		const id = participantId("p-test-1");
		banterEngine.start(id, DISABLED_CONFIG);
		expect(banterEngine.isRunning(id)).toBe(false);
		expect(banterEngine.getPhase(id)).toBe("idle");
	});

	test("stop is idempotent on never-started ids", () => {
		const id = participantId("p-test-2");
		expect(() => banterEngine.stop(id)).not.toThrow();
		expect(banterEngine.isRunning(id)).toBe(false);
	});

	test("sessionCount reflects active sessions only", () => {
		const before = banterEngine.sessionCount();
		banterEngine.start(participantId("p-test-3"), DISABLED_CONFIG);
		expect(banterEngine.sessionCount()).toBe(before);
	});
});
