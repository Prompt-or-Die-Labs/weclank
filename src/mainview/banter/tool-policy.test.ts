import { describe, expect, test } from "bun:test";
import {
	FULL_TOOL_PERMISSIONS,
	SAFE_TOOL_PERMISSIONS,
	runtimeAutonomy,
	runtimeToolPermissions,
} from "./tool-policy";
import type { BanterConfig } from "../core/types";

const BASE_CONFIG: BanterConfig = {
	enabled: true,
	twitchChannel: "",
	llmProvider: "openrouter",
	llmModel: "openrouter/free",
	systemPrompt: "test",
	voiceActivityGate: true,
	proactiveOnTranscript: false,
};

describe("tool-policy defaults", () => {
	test("SAFE permissions allow overlays but not music", () => {
		expect(SAFE_TOOL_PERMISSIONS).toEqual({ controlOverlays: true, controlMusic: false });
	});

	test("FULL permissions allow overlays and music", () => {
		expect(FULL_TOOL_PERMISSIONS).toEqual({ controlOverlays: true, controlMusic: true });
	});
});

describe("runtimeAutonomy", () => {
	test("returns the configured autonomy level when set", () => {
		expect(runtimeAutonomy({ ...BASE_CONFIG, autonomyLevel: "suggested" })).toBe("suggested");
		expect(runtimeAutonomy({ ...BASE_CONFIG, autonomyLevel: "auto-safe" })).toBe("auto-safe");
		expect(runtimeAutonomy({ ...BASE_CONFIG, autonomyLevel: "full" })).toBe("full");
	});

	test("falls back to 'full' when autonomy is unset", () => {
		expect(runtimeAutonomy(BASE_CONFIG)).toBe("full");
	});
});

describe("runtimeToolPermissions", () => {
	test("returns the configured permissions when set", () => {
		const permissions = { controlOverlays: false, controlMusic: false };
		expect(runtimeToolPermissions({ ...BASE_CONFIG, toolPermissions: permissions })).toEqual(permissions);
	});

	test("falls back to FULL permissions when unset", () => {
		expect(runtimeToolPermissions(BASE_CONFIG)).toEqual(FULL_TOOL_PERMISSIONS);
	});

	test("returned object is the FULL permissions singleton (no spurious copies)", () => {
		// The fallback returning the live constant is intentional — exported
		// permissions objects are never mutated, so sharing the reference is
		// fine. If the fallback ever clones, this test will catch it and
		// prompt a deliberate review.
		expect(runtimeToolPermissions(BASE_CONFIG)).toBe(FULL_TOOL_PERMISSIONS);
	});
});
