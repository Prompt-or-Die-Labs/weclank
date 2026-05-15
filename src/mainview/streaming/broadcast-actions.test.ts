// Unit tests for broadcast-actions. Mocks the heavy collaborators
// (egressController, localRecorder, dialogs, channel store) so we
// exercise the orchestration logic without a real MediaRecorder or
// ffmpeg.
//
// The point of these tests is to lock in the BEHAVIOR every caller
// (AppHeader button, hotkeys, obs-ws bridge, command palette,
// command-palette, native menu) sees through this module — if any
// of them call goLive() / toggleBroadcast() / stopBroadcast() etc.,
// they must observe the same channel-resolution + dialog-flow
// semantics.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { studio } from "../state/studio-store";

// Mocks BEFORE the SUT imports.
let lastEgressStartArgs: unknown = null;
let egressStartShouldThrow: Error | null = null;
let egressStopCalls = 0;
let localRecorderState = { isRecording: false };
let localRecorderStartCalls = 0;
let localRecorderStartShouldReturn: boolean | Error = true;
let localRecorderStopCalls = 0;
let channelLinkDialogReturns: { id: string; rtmpUrl: string; streamKey: string } | null = null;
let loadChannelsReturns: Array<{ id: string }> = [];
let resolveActiveChannelsReturns: Array<{ rtmpUrl: string; streamKey: string }> = [];
let toastCalls: Array<{ message: string; tone: string }> = [];
let goLiveFailedDialogCalls: string[] = [];

mock.module("./egress", () => ({
	egressController: {
		start: mock(async (destinations: unknown) => {
			lastEgressStartArgs = destinations;
			if (egressStartShouldThrow) throw egressStartShouldThrow;
		}),
		stop: mock(() => { egressStopCalls++; }),
	},
}));

mock.module("./recorder", () => ({
	localRecorder: {
		get isRecording() { return localRecorderState.isRecording; },
		start: mock(async () => {
			localRecorderStartCalls++;
			if (localRecorderStartShouldReturn instanceof Error) throw localRecorderStartShouldReturn;
			if (localRecorderStartShouldReturn) localRecorderState.isRecording = true;
			return localRecorderStartShouldReturn;
		}),
		stop: mock(() => {
			localRecorderStopCalls++;
			localRecorderState.isRecording = false;
		}),
	},
}));

mock.module("./channels", () => ({
	loadChannels: () => loadChannelsReturns,
	resolveActiveChannels: () => resolveActiveChannelsReturns,
}));

mock.module("./channel-link-dialog", () => ({
	openChannelLinkDialog: async () => channelLinkDialogReturns,
}));

mock.module("../components/go-live-failed-dialog", () => ({
	openGoLiveFailedDialog: (detail: string) => { goLiveFailedDialogCalls.push(detail); },
}));

mock.module("../components/overlays", () => ({
	toast: (message: string, tone = "info") => { toastCalls.push({ message, tone }); },
}));

// Now import the SUT.
const { goLive, stopBroadcast, toggleBroadcast, startRecording, stopRecording, toggleRecording } = await import("./broadcast-actions");

beforeEach(() => {
	lastEgressStartArgs = null;
	egressStartShouldThrow = null;
	egressStopCalls = 0;
	localRecorderState = { isRecording: false };
	localRecorderStartCalls = 0;
	localRecorderStartShouldReturn = true;
	localRecorderStopCalls = 0;
	channelLinkDialogReturns = null;
	loadChannelsReturns = [];
	resolveActiveChannelsReturns = [];
	toastCalls = [];
	goLiveFailedDialogCalls = [];
	studio.setStream({ live: false, activeChannelIds: [] });
});

afterEach(() => {
	studio.setStream({ live: false });
});

describe("goLive — first-time path (no channels)", () => {
	test("opens channel-link dialog and starts on user-created channel", async () => {
		channelLinkDialogReturns = { id: "ch-1", rtmpUrl: "rtmp://twitch", streamKey: "key" };
		const ok = await goLive();
		expect(ok).toBe(true);
		expect(lastEgressStartArgs).toEqual([{ rtmpUrl: "rtmp://twitch", streamKey: "key" }]);
		expect(studio.state.stream.live).toBe(true);
	});

	test("returns false when the user cancels the channel-link dialog", async () => {
		channelLinkDialogReturns = null;
		const ok = await goLive();
		expect(ok).toBe(false);
		expect(lastEgressStartArgs).toBeNull();
		expect(studio.state.stream.live).toBe(false);
	});
});

describe("goLive — existing channels path", () => {
	test("starts with resolved active channels", async () => {
		loadChannelsReturns = [{ id: "ch-1" }];
		resolveActiveChannelsReturns = [
			{ rtmpUrl: "rtmp://twitch", streamKey: "k1" },
			{ rtmpUrl: "rtmp://youtube", streamKey: "k2" },
		];
		const ok = await goLive();
		expect(ok).toBe(true);
		expect(lastEgressStartArgs).toEqual([
			{ rtmpUrl: "rtmp://twitch", streamKey: "k1" },
			{ rtmpUrl: "rtmp://youtube", streamKey: "k2" },
		]);
	});

	test("surfaces error toast when no active channel is picked", async () => {
		loadChannelsReturns = [{ id: "ch-1" }];
		resolveActiveChannelsReturns = [];
		const ok = await goLive();
		expect(ok).toBe(false);
		expect(toastCalls.some((c) => c.tone === "error" && c.message.toLowerCase().includes("channel"))).toBe(true);
	});
});

describe("goLive — failure path", () => {
	test("egressController.start throwing surfaces a go-live-failed dialog", async () => {
		loadChannelsReturns = [{ id: "ch-1" }];
		resolveActiveChannelsReturns = [{ rtmpUrl: "rtmp://x", streamKey: "k" }];
		egressStartShouldThrow = new Error("ffmpeg not on PATH");
		const ok = await goLive();
		expect(ok).toBe(false);
		expect(studio.state.stream.live).toBe(false);
		expect(goLiveFailedDialogCalls).toHaveLength(1);
	});

	test("already-live goLive() is a no-op success", async () => {
		studio.setStream({ live: true });
		const ok = await goLive();
		expect(ok).toBe(true);
		expect(lastEgressStartArgs).toBeNull(); // never called
	});
});

describe("stopBroadcast", () => {
	test("calls egressController.stop when live", () => {
		studio.setStream({ live: true });
		stopBroadcast();
		expect(egressStopCalls).toBe(1);
	});

	test("is a no-op when not live", () => {
		stopBroadcast();
		expect(egressStopCalls).toBe(0);
	});
});

describe("toggleBroadcast", () => {
	test("stops when live", async () => {
		studio.setStream({ live: true });
		await toggleBroadcast();
		expect(egressStopCalls).toBe(1);
	});

	test("goes live when not live (existing channels)", async () => {
		loadChannelsReturns = [{ id: "ch-1" }];
		resolveActiveChannelsReturns = [{ rtmpUrl: "rtmp://x", streamKey: "k" }];
		await toggleBroadcast();
		expect(lastEgressStartArgs).toEqual([{ rtmpUrl: "rtmp://x", streamKey: "k" }]);
	});
});

describe("startRecording / stopRecording / toggleRecording", () => {
	test("startRecording calls localRecorder.start + toasts on success", async () => {
		const ok = await startRecording();
		expect(ok).toBe(true);
		expect(localRecorderStartCalls).toBe(1);
		expect(toastCalls.some((c) => c.tone === "success" && c.message.includes("Recording"))).toBe(true);
	});

	test("startRecording returns false when start returns false (user cancelled save dialog)", async () => {
		localRecorderStartShouldReturn = false;
		const ok = await startRecording();
		expect(ok).toBe(false);
	});

	test("startRecording surfaces an error toast on throw", async () => {
		localRecorderStartShouldReturn = new Error("disk full");
		const ok = await startRecording();
		expect(ok).toBe(false);
		expect(toastCalls.some((c) => c.tone === "error")).toBe(true);
	});

	test("stopRecording calls localRecorder.stop only when recording", () => {
		stopRecording();
		expect(localRecorderStopCalls).toBe(0);

		localRecorderState.isRecording = true;
		stopRecording();
		expect(localRecorderStopCalls).toBe(1);
	});

	test("toggleRecording stops if recording, starts otherwise", async () => {
		localRecorderState.isRecording = true;
		await toggleRecording();
		expect(localRecorderStopCalls).toBe(1);
		expect(localRecorderStartCalls).toBe(0);

		localRecorderState.isRecording = false;
		await toggleRecording();
		expect(localRecorderStartCalls).toBe(1);
	});
});
