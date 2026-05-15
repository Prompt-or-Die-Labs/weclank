import { describe, expect, test } from "bun:test";
import {
	OBS_EVENTS,
	obsStudioShimSource,
	SHIM_VERSION,
} from "./obsstudio-shim";

describe("obsstudio-shim source", () => {
	test("is well-formed JavaScript (parses without error)", () => {
		const src = obsStudioShimSource();
		// new Function() throws on syntax errors. We don't EXECUTE it
		// here (it expects `window`, `postMessage`, etc.); we just
		// verify it parses.
		expect(() => new Function(src)).not.toThrow();
	});

	test("baked-in pluginVersion matches the export", () => {
		const src = obsStudioShimSource();
		expect(src).toContain(`pluginVersion: ${JSON.stringify(SHIM_VERSION)}`);
	});

	test("custom version override is embedded verbatim", () => {
		const src = obsStudioShimSource("99.99.99-test");
		expect(src).toContain('"99.99.99-test"');
	});

	test("exports every OBS method documented in the obs-browser README", () => {
		const src = obsStudioShimSource();
		// Per src/mainview/renderers/browser-renderer.ts handler list.
		const methods = [
			"getControlLevel",
			"getStatus",
			"getCurrentScene",
			"getScenes",
			"getTransitions",
			"getCurrentTransition",
			"setCurrentScene",
			"setCurrentTransition",
			"startStreaming",
			"stopStreaming",
			"startRecording",
			"stopRecording",
			"pauseRecording",
			"unpauseRecording",
			"saveReplayBuffer",
			"startReplayBuffer",
			"stopReplayBuffer",
			"startVirtualcam",
			"stopVirtualcam",
		];
		for (const m of methods) {
			expect(src).toContain(`${m}: function`);
		}
	});

	test("self-guards against double initialisation", () => {
		const src = obsStudioShimSource();
		// The IIFE checks `if (window.obsstudio) return;` so re-injecting
		// the shim (e.g. on iframe.src change) doesn't blow away pending
		// callbacks.
		expect(src).toContain("if (window.obsstudio) return");
	});
});

describe("OBS_EVENTS table", () => {
	test("contains the obs-browser README's event names", () => {
		const required = [
			"obsSceneChanged",
			"obsSceneListChanged",
			"obsStreamingStarting",
			"obsStreamingStarted",
			"obsStreamingStopping",
			"obsStreamingStopped",
			"obsRecordingStarted",
			"obsRecordingStopped",
			"obsReplaybufferSaved",
			"obsExit",
		];
		const present = Object.values(OBS_EVENTS) as string[];
		for (const e of required) {
			expect(present).toContain(e);
		}
	});
});
