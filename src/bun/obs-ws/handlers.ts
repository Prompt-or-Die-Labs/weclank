// obs-websocket v5 request handlers — minimum viable subset for
// Stream Deck / Companion / Touch Portal compatibility.
//
// Handlers operate on a `StudioAdapter` interface that the server
// implementation wires up. Decoupling from concrete state shape keeps
// this module testable without depending on the full studio store.

export const OBS_WS_VERSION = "5.5.0"; // protocol version we claim
export const OBS_STUDIO_VERSION = "weclank-0.3.0"; // user-agent style

export interface SceneSummary {
	sceneName: string;
	sceneIndex: number;
}

export interface StudioAdapter {
	getScenes(): SceneSummary[];
	getCurrentSceneName(): string | null;
	setCurrentSceneName(name: string): boolean;
	isStreamLive(): boolean;
	isRecording(): boolean;
	startStream(): Promise<boolean>;
	stopStream(): Promise<boolean>;
	startRecord(): Promise<boolean>;
	stopRecord(): Promise<boolean>;
	getRecordTimecode(): string; // "HH:MM:SS.mmm"
	getStreamTimecode(): string;
}

export interface HandlerResult {
	ok: boolean;
	data?: Record<string, unknown>;
	comment?: string;
}

export type HandlerFn = (
	args: Record<string, unknown>,
	studio: StudioAdapter,
) => Promise<HandlerResult> | HandlerResult;

export const HANDLERS: Record<string, HandlerFn> = {
	GetVersion: () => ({
		ok: true,
		data: {
			obsVersion: OBS_STUDIO_VERSION,
			obsWebSocketVersion: OBS_WS_VERSION,
			rpcVersion: 1,
			availableRequests: Object.keys(HANDLERS),
			supportedImageFormats: [],
			platform: process.platform,
			platformDescription: `weclank on ${process.platform}`,
		},
	}),

	GetSceneList: (_, studio) => {
		const scenes = studio.getScenes();
		const current = studio.getCurrentSceneName();
		return {
			ok: true,
			data: {
				currentProgramSceneName: current ?? "",
				currentPreviewSceneName: null,
				scenes,
			},
		};
	},

	GetCurrentProgramScene: (_, studio) => {
		const name = studio.getCurrentSceneName();
		if (!name) return { ok: false, comment: "no active scene" };
		return { ok: true, data: { currentProgramSceneName: name, sceneName: name } };
	},

	SetCurrentProgramScene: (args, studio) => {
		const name = args["sceneName"];
		if (typeof name !== "string" || !name) {
			return { ok: false, comment: "sceneName required" };
		}
		const ok = studio.setCurrentSceneName(name);
		return ok ? { ok: true } : { ok: false, comment: `unknown scene "${name}"` };
	},

	GetStreamStatus: (_, studio) => ({
		ok: true,
		data: {
			outputActive: studio.isStreamLive(),
			outputReconnecting: false,
			outputTimecode: studio.getStreamTimecode(),
			outputDuration: 0,
			outputCongestion: 0,
			outputBytes: 0,
			outputSkippedFrames: 0,
			outputTotalFrames: 0,
		},
	}),

	StartStream: async (_, studio) => {
		const ok = await studio.startStream();
		return ok ? { ok: true } : { ok: false, comment: "stream start failed" };
	},

	StopStream: async (_, studio) => {
		const ok = await studio.stopStream();
		return ok ? { ok: true } : { ok: false, comment: "stream stop failed" };
	},

	ToggleStream: async (_, studio) => {
		const live = studio.isStreamLive();
		const ok = live ? await studio.stopStream() : await studio.startStream();
		return ok
			? { ok: true, data: { outputActive: !live } }
			: { ok: false, comment: "toggle failed" };
	},

	GetRecordStatus: (_, studio) => ({
		ok: true,
		data: {
			outputActive: studio.isRecording(),
			outputPaused: false,
			outputTimecode: studio.getRecordTimecode(),
			outputDuration: 0,
			outputBytes: 0,
		},
	}),

	StartRecord: async (_, studio) => {
		const ok = await studio.startRecord();
		return ok ? { ok: true } : { ok: false, comment: "record start failed" };
	},

	StopRecord: async (_, studio) => {
		const ok = await studio.stopRecord();
		return ok ? { ok: true, data: { outputPath: "" } } : { ok: false, comment: "record stop failed" };
	},

	ToggleRecord: async (_, studio) => {
		const rec = studio.isRecording();
		const ok = rec ? await studio.stopRecord() : await studio.startRecord();
		return ok ? { ok: true } : { ok: false, comment: "toggle failed" };
	},

	BroadcastCustomEvent: (args) => {
		const eventData = args["eventData"];
		if (eventData === undefined || eventData === null || typeof eventData !== "object") {
			return { ok: false, comment: "eventData must be an object" };
		}
		// The server is expected to broadcast this back to all clients
		// (including the sender) as a CustomEvent. The server impl wires
		// the broadcast; here we just acknowledge.
		return { ok: true };
	},
};
