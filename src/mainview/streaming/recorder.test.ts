import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { participantId } from "../core/ids";
import type { ParticipantId } from "../core/ids";
import type { SourceKind } from "../core/types";

let startCalls = 0;
let finishCalls = 0;
let cancelCalls = 0;
let sourceCreateCalls = 0;
let startResult: { success: boolean; path?: string; reason?: string; error?: string };
let finishResult: { success: boolean; path?: string; reason?: string; error?: string };
let lastChunkInterval = 0;
let lastSuggestedName = "";
let lastSourceKind = "";
let lastSourceStartVideo = false;
const events: string[] = [];
const originalMediaRecorder = globalThis.MediaRecorder;
const hostId = participantId("host");

class DelayedFinalMediaRecorder extends EventTarget {
	static isTypeSupported(): boolean {
		return true;
	}

	state: RecordingState = "inactive";
	ondataavailable: ((event: BlobEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	constructor(_stream: MediaStream, _options: MediaRecorderOptions) {
		super();
	}

	start(interval?: number): void {
		lastChunkInterval = interval ?? 0;
		this.state = "recording";
	}

	requestData(): void {}

	stop(): void {
		this.state = "inactive";
		this.dispatchEvent(new Event("stop"));
		setTimeout(() => this.emitData(), 600);
	}

	private emitData(): void {
		const event = new Event("dataavailable") as BlobEvent;
		Object.defineProperty(event, "data", { value: new Blob(["final"]) });
		this.ondataavailable?.(event);
		this.dispatchEvent(event);
	}
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > 2_500) throw new Error("Timed out waiting for recorder test condition");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function submitRecordingName(value?: string): Promise<void> {
	await waitFor(() => document.querySelector(".recording-name") !== null);
	const input = document.querySelector<HTMLInputElement>(".recording-name input")!;
	if (value !== undefined) input.value = value;
	document.querySelector<HTMLFormElement>(".recording-name")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

async function cancelRecordingName(): Promise<void> {
	await waitFor(() => document.querySelector(".recording-name") !== null);
	document.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();
}

async function cancelRecordingSource(): Promise<void> {
	await waitFor(() => document.querySelector(".recording-source") !== null);
	document.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();
}

async function chooseRecordingSource(kind: "screen" | "camera"): Promise<void> {
	await waitFor(() => document.querySelector(".recording-source") !== null);
	document.querySelector<HTMLButtonElement>(`[data-kind="${kind}"]`)?.click();
}

async function markHostCameraOn(): Promise<void> {
	const { studio } = await import("../state/studio-store");
	studio.updateParticipant(hostId, { cameraOff: false });
}

beforeAll(() => {
	mock.module("../rpc", () => ({
		bunRpc: {
			startRecordingFile: async ({ suggestedName }: { suggestedName: string }) => {
				startCalls += 1;
				lastSuggestedName = suggestedName;
				return startResult;
			},
			cancelRecordingFile: async () => {
				cancelCalls += 1;
				return {};
			},
			writeRecordingChunk: async () => {
				events.push("write");
				return { ok: true };
			},
			finishRecordingFile: async () => {
				finishCalls += 1;
				events.push("finish");
				return finishResult;
			},
		},
	}));
	mock.module("../state/source-factory", () => ({
		createParticipantFromKind: async (kind: SourceKind, opts?: { startVideo?: boolean }) => {
			sourceCreateCalls += 1;
			lastSourceKind = kind;
			lastSourceStartVideo = opts?.startVideo === true;
			const { studio } = await import("../state/studio-store");
			const id = participantId(`recording-${kind}`) as ParticipantId;
			studio.addParticipant({
				id,
				displayName: kind,
				kind,
				muted: false,
				cameraOff: false,
				isAgent: false,
			});
			studio.addSource(studio.activeScene.id, id);
			return id;
		},
	}));
	mock.module("./stream-engine", () => ({
		streamEngine: {
			setResolution: () => {},
			setTargetFps: () => {},
			getOutputStream: () => new MediaStream(),
		},
	}));
});

beforeEach(async () => {
	startCalls = 0;
	finishCalls = 0;
	cancelCalls = 0;
	sourceCreateCalls = 0;
	lastChunkInterval = 0;
	lastSuggestedName = "";
	lastSourceKind = "";
	lastSourceStartVideo = false;
	events.length = 0;
	startResult = { success: false, reason: "canceled" };
	finishResult = { success: false, reason: "canceled" };
	const { studio } = await import("../state/studio-store");
	studio.installRestored({});
});

afterEach(() => {
	if (originalMediaRecorder) {
		Object.defineProperty(globalThis, "MediaRecorder", {
			configurable: true,
			value: originalMediaRecorder,
		});
		} else {
			delete (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
		}
		document.querySelector<HTMLButtonElement>(".modal__close")?.click();
		const root = document.querySelector<HTMLElement>("#overlay-root");
		root?.replaceChildren();
		for (const child of Array.from(document.body.children)) {
			if (child !== root) child.remove();
		}
	});

describe("localRecorder", () => {
	test("reports a canceled picker without entering recording state", async () => {
		const { localRecorder } = await import("./recorder");
		await markHostCameraOn();

		const start = localRecorder.start();
		await submitRecordingName();
		const started = await start;

		expect(started).toBe(false);
		expect(startCalls).toBe(1);
		expect(lastSuggestedName).toMatch(/^weclank-\d{4}-\d{2}-\d{2}\.mp4$/);
		expect(localRecorder.isRecording).toBe(false);
	});

	test("cancels before the folder picker when the name dialog is canceled", async () => {
		const { localRecorder } = await import("./recorder");
		await markHostCameraOn();

		const start = localRecorder.start();
		await cancelRecordingName();

		expect(await start).toBe(false);
		expect(startCalls).toBe(0);
		expect(localRecorder.isRecording).toBe(false);
	});

	test("cancels before the folder picker when the empty-stage source setup is canceled", async () => {
		const { localRecorder } = await import("./recorder");

		const start = localRecorder.start();
		await cancelRecordingSource();

		expect(await start).toBe(false);
		expect(sourceCreateCalls).toBe(0);
		expect(startCalls).toBe(0);
		expect(localRecorder.isRecording).toBe(false);
	});

	test("adds a screen source before naming an empty-stage recording", async () => {
		const { localRecorder } = await import("./recorder");

		const start = localRecorder.start();
		await chooseRecordingSource("screen");
		await submitRecordingName("screen proof");
		const started = await start;
		const { studio } = await import("../state/studio-store");
		const screenSource = studio.activeScene.sources.find((source) => source.participantId === participantId("recording-screen"));

		expect(started).toBe(false);
		expect(sourceCreateCalls).toBe(1);
		expect(lastSourceKind).toBe("screen");
		expect(lastSourceStartVideo).toBe(true);
		expect(startCalls).toBe(1);
		expect(lastSuggestedName).toBe("screen proof.mp4");
		expect(screenSource).toMatchObject({ x: 0, y: 0, w: 1, h: 1, visible: true });
		expect(localRecorder.isRecording).toBe(false);
	});

	test("writes the final chunk before finishing the recording file", async () => {
		Object.defineProperty(globalThis, "MediaRecorder", {
			configurable: true,
			value: DelayedFinalMediaRecorder,
		});
		startResult = { success: true, path: "/tmp/weclank.mp4" };
		const { localRecorder } = await import("./recorder");
		await markHostCameraOn();

		const start = localRecorder.start();
		await submitRecordingName("launch clip");
		const started = await start;
		localRecorder.stop();
		await waitFor(() => finishCalls === 1);

		expect(started).toBe(true);
		expect(lastSuggestedName).toBe("launch clip.mp4");
		expect(lastChunkInterval).toBe(1_000);
		expect(finishCalls).toBe(1);
		expect(events.indexOf("write")).toBeGreaterThanOrEqual(0);
		expect(events.indexOf("write")).toBeLessThan(events.indexOf("finish"));
		expect(cancelCalls).toBe(0);
		expect(localRecorder.isRecording).toBe(false);
	});
});
