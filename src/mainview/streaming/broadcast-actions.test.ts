// Unit tests for broadcast-actions. Uses the createBroadcastActions
// factory so we pass fake collaborators in — no mock.module pollution.
// Bun's mock.module is process-wide and irreversible, so any test
// that uses it stubs out modules for every later test in CI's
// alphabetical run order; the factory shape avoids that landmine.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { studio } from "../state/studio-store";
import { createBroadcastActions, type BroadcastActionsDeps } from "./broadcast-actions";

interface FakeContext {
	deps: BroadcastActionsDeps;
	state: {
		lastEgressStartArgs: unknown;
		egressStopCalls: number;
		isRecording: boolean;
		localRecorderStartCalls: number;
		localRecorderStartReturn: boolean | Error;
		localRecorderStopCalls: number;
		channelLinkResult: { id: string; rtmpUrl: string; streamKey: string } | null;
		channels: Array<{ id: string }>;
		activeChannels: Array<{ rtmpUrl: string; streamKey: string }>;
		egressStartShouldThrow: Error | null;
		toastCalls: Array<{ message: string; tone: string }>;
		goLiveFailedCalls: string[];
		replayAttached: boolean;
		replaySnapshot: { blob: Blob; mimeType: string; seconds: number } | null;
		saveRecordingResult: { success: boolean; path?: string; reason?: string; error?: string };
	};
}

function fakeContext(): FakeContext {
	const state: FakeContext["state"] = {
		lastEgressStartArgs: null,
		egressStopCalls: 0,
		isRecording: false,
		localRecorderStartCalls: 0,
		localRecorderStartReturn: true,
		localRecorderStopCalls: 0,
		channelLinkResult: null,
		channels: [],
		activeChannels: [],
		egressStartShouldThrow: null,
		toastCalls: [],
		goLiveFailedCalls: [],
		replayAttached: false,
		replaySnapshot: null,
		saveRecordingResult: { success: true, path: "/tmp/replay.webm" },
	};
	const deps: BroadcastActionsDeps = {
		egressController: {
			async start(destinations) {
				state.lastEgressStartArgs = destinations;
				if (state.egressStartShouldThrow) throw state.egressStartShouldThrow;
			},
			stop() { state.egressStopCalls++; },
		},
		localRecorder: {
			get isRecording() { return state.isRecording; },
			async start() {
				state.localRecorderStartCalls++;
				if (state.localRecorderStartReturn instanceof Error) throw state.localRecorderStartReturn;
				if (state.localRecorderStartReturn) state.isRecording = true;
				return state.localRecorderStartReturn;
			},
			stop() { state.localRecorderStopCalls++; state.isRecording = false; },
		},
		replayBuffer: {
			get isAttached() { return state.replayAttached; },
			snapshot() { return state.replaySnapshot; },
		},
		loadChannels: () => state.channels,
		resolveActiveChannels: () => state.activeChannels,
		openChannelLinkDialog: async () => state.channelLinkResult,
		openGoLiveFailedDialog: (detail) => { state.goLiveFailedCalls.push(detail); },
		toast: (message, tone = "info") => { state.toastCalls.push({ message, tone }); },
		saveRecordingRpc: async () => state.saveRecordingResult,
	};
	return { deps, state };
}

beforeEach(() => {
	studio.setStream({ live: false, activeChannelIds: [] });
});
afterEach(() => {
	studio.setStream({ live: false });
});

describe("goLive — first-time path (no channels)", () => {
	test("opens channel-link dialog and starts on user-created channel", async () => {
		const ctx = fakeContext();
		ctx.state.channelLinkResult = { id: "ch-1", rtmpUrl: "rtmp://twitch", streamKey: "key" };
		const ok = await createBroadcastActions(ctx.deps).goLive();
		expect(ok).toBe(true);
		expect(ctx.state.lastEgressStartArgs).toEqual([{ rtmpUrl: "rtmp://twitch", streamKey: "key" }]);
		expect(studio.state.stream.live).toBe(true);
	});

	test("returns false when the user cancels the channel-link dialog", async () => {
		const ctx = fakeContext();
		ctx.state.channelLinkResult = null;
		const ok = await createBroadcastActions(ctx.deps).goLive();
		expect(ok).toBe(false);
		expect(ctx.state.lastEgressStartArgs).toBeNull();
		expect(studio.state.stream.live).toBe(false);
	});
});

describe("goLive — existing channels path", () => {
	test("starts with resolved active channels", async () => {
		const ctx = fakeContext();
		ctx.state.channels = [{ id: "ch-1" }];
		ctx.state.activeChannels = [
			{ rtmpUrl: "rtmp://twitch", streamKey: "k1" },
			{ rtmpUrl: "rtmp://youtube", streamKey: "k2" },
		];
		const ok = await createBroadcastActions(ctx.deps).goLive();
		expect(ok).toBe(true);
		expect(ctx.state.lastEgressStartArgs).toEqual([
			{ rtmpUrl: "rtmp://twitch", streamKey: "k1" },
			{ rtmpUrl: "rtmp://youtube", streamKey: "k2" },
		]);
	});

	test("surfaces error toast when no active channel is picked", async () => {
		const ctx = fakeContext();
		ctx.state.channels = [{ id: "ch-1" }];
		ctx.state.activeChannels = [];
		const ok = await createBroadcastActions(ctx.deps).goLive();
		expect(ok).toBe(false);
		expect(ctx.state.toastCalls.some((c) => c.tone === "error" && c.message.toLowerCase().includes("channel"))).toBe(true);
	});
});

describe("goLive — failure path", () => {
	test("egressController.start throwing surfaces a go-live-failed dialog", async () => {
		const ctx = fakeContext();
		ctx.state.channels = [{ id: "ch-1" }];
		ctx.state.activeChannels = [{ rtmpUrl: "rtmp://x", streamKey: "k" }];
		ctx.state.egressStartShouldThrow = new Error("ffmpeg not on PATH");
		const ok = await createBroadcastActions(ctx.deps).goLive();
		expect(ok).toBe(false);
		expect(studio.state.stream.live).toBe(false);
		expect(ctx.state.goLiveFailedCalls).toHaveLength(1);
	});

	test("already-live goLive() is a no-op success", async () => {
		const ctx = fakeContext();
		studio.setStream({ live: true });
		const ok = await createBroadcastActions(ctx.deps).goLive();
		expect(ok).toBe(true);
		expect(ctx.state.lastEgressStartArgs).toBeNull();
	});
});

describe("stopBroadcast", () => {
	test("calls egressController.stop when live", () => {
		const ctx = fakeContext();
		studio.setStream({ live: true });
		createBroadcastActions(ctx.deps).stopBroadcast();
		expect(ctx.state.egressStopCalls).toBe(1);
	});

	test("is a no-op when not live", () => {
		const ctx = fakeContext();
		createBroadcastActions(ctx.deps).stopBroadcast();
		expect(ctx.state.egressStopCalls).toBe(0);
	});
});

describe("toggleBroadcast", () => {
	test("stops when live", async () => {
		const ctx = fakeContext();
		studio.setStream({ live: true });
		await createBroadcastActions(ctx.deps).toggleBroadcast();
		expect(ctx.state.egressStopCalls).toBe(1);
	});

	test("goes live when not live (existing channels)", async () => {
		const ctx = fakeContext();
		ctx.state.channels = [{ id: "ch-1" }];
		ctx.state.activeChannels = [{ rtmpUrl: "rtmp://x", streamKey: "k" }];
		await createBroadcastActions(ctx.deps).toggleBroadcast();
		expect(ctx.state.lastEgressStartArgs).toEqual([{ rtmpUrl: "rtmp://x", streamKey: "k" }]);
	});
});

describe("startRecording / stopRecording / toggleRecording", () => {
	test("startRecording calls localRecorder.start + toasts on success", async () => {
		const ctx = fakeContext();
		const ok = await createBroadcastActions(ctx.deps).startRecording();
		expect(ok).toBe(true);
		expect(ctx.state.localRecorderStartCalls).toBe(1);
		expect(ctx.state.toastCalls.some((c) => c.tone === "success" && c.message.includes("Recording"))).toBe(true);
	});

	test("startRecording returns false when start returns false (user cancelled save dialog)", async () => {
		const ctx = fakeContext();
		ctx.state.localRecorderStartReturn = false;
		const ok = await createBroadcastActions(ctx.deps).startRecording();
		expect(ok).toBe(false);
	});

	test("startRecording surfaces an error toast on throw", async () => {
		const ctx = fakeContext();
		ctx.state.localRecorderStartReturn = new Error("disk full");
		const ok = await createBroadcastActions(ctx.deps).startRecording();
		expect(ok).toBe(false);
		expect(ctx.state.toastCalls.some((c) => c.tone === "error")).toBe(true);
	});

	test("stopRecording calls localRecorder.stop only when recording", () => {
		const ctx = fakeContext();
		const actions = createBroadcastActions(ctx.deps);
		actions.stopRecording();
		expect(ctx.state.localRecorderStopCalls).toBe(0);

		ctx.state.isRecording = true;
		actions.stopRecording();
		expect(ctx.state.localRecorderStopCalls).toBe(1);
	});

	test("toggleRecording stops if recording, starts otherwise", async () => {
		const ctx = fakeContext();
		ctx.state.isRecording = true;
		const actions = createBroadcastActions(ctx.deps);
		await actions.toggleRecording();
		expect(ctx.state.localRecorderStopCalls).toBe(1);
		expect(ctx.state.localRecorderStartCalls).toBe(0);

		ctx.state.isRecording = false;
		await actions.toggleRecording();
		expect(ctx.state.localRecorderStartCalls).toBe(1);
	});
});

describe("saveReplayBufferNow", () => {
	test("no-ops with info toast when buffer not attached", async () => {
		const ctx = fakeContext();
		ctx.state.replayAttached = false;
		const ok = await createBroadcastActions(ctx.deps).saveReplayBufferNow();
		expect(ok).toBe(false);
		expect(ctx.state.toastCalls.some((c) => c.tone === "info" && c.message.includes("only runs"))).toBe(true);
	});

	test("no-ops with info toast when buffer empty", async () => {
		const ctx = fakeContext();
		ctx.state.replayAttached = true;
		ctx.state.replaySnapshot = null;
		const ok = await createBroadcastActions(ctx.deps).saveReplayBufferNow();
		expect(ok).toBe(false);
	});

	test("happy path: persists + success toast", async () => {
		const ctx = fakeContext();
		ctx.state.replayAttached = true;
		ctx.state.replaySnapshot = {
			blob: new Blob([new Uint8Array(100)], { type: "video/webm" }),
			mimeType: "video/webm",
			seconds: 30,
		};
		const ok = await createBroadcastActions(ctx.deps).saveReplayBufferNow();
		expect(ok).toBe(true);
		expect(ctx.state.toastCalls.some((c) => c.tone === "success" && c.message.includes("Replay saved"))).toBe(true);
	});
});
