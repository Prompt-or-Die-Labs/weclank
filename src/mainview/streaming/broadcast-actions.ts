// One typed entry point for go-live / stop-stream / start-record /
// stop-record. The AppHeader button, the hotkey handler, the
// command palette, the obs-ws bridge, and any future control surface
// all call the same functions here.
//
// Why a separate module: before this existed, the obs-ws bridge and
// the command palette both reached into the DOM (`getElementById("go-live")?.click()`)
// to start a stream. That coupling means a button-ID rename silently
// breaks every external trigger. With these functions in one place,
// the AppHeader button is one of many callers — not the source of truth.
//
// Why the factory shape: bun's `mock.module` is process-wide and
// irreversible — using it in a test pollutes every later test. The
// factory takes deps as a parameter so tests can construct a fake-
// wired action set without touching the singleton or its imports.

import { studio } from "../state/studio-store";
import { egressController as defaultEgressController } from "./egress";
import { localRecorder as defaultLocalRecorder } from "./recorder";
import { replayBuffer as defaultReplayBuffer } from "./replay-buffer";
import { loadChannels as defaultLoadChannels, resolveActiveChannels as defaultResolveActiveChannels } from "./channels";
import { openChannelLinkDialog as defaultOpenChannelLinkDialog } from "./channel-link-dialog";
import { openGoLiveFailedDialog as defaultOpenGoLiveFailedDialog } from "../components/go-live-failed-dialog";
import { toast as defaultToast } from "../components/overlays";
import { StudioError, userMessageFor } from "../core/errors";
import { bunRpc as defaultBunRpc } from "../rpc";
import { arrayBufferToBase64 } from "./base64";

export interface BroadcastActionsDeps {
	egressController: { start(destinations: Array<{ rtmpUrl: string; streamKey: string }>): Promise<void>; stop(): void };
	localRecorder: { readonly isRecording: boolean; start(): Promise<boolean>; stop(): void };
	replayBuffer: {
		readonly isAttached: boolean;
		snapshot(): { blob: Blob; mimeType: string; seconds: number } | null;
	};
	loadChannels(): Array<{ id: string }>;
	resolveActiveChannels(ids: string[] | undefined): Array<{ rtmpUrl: string; streamKey: string }>;
	openChannelLinkDialog(): Promise<{ id: string; rtmpUrl: string; streamKey: string } | null>;
	openGoLiveFailedDialog(detail: string): void;
	toast(message: string, tone?: "info" | "success" | "error"): void;
	saveRecordingRpc(args: {
		blobBase64: string;
		suggestedName: string;
		mimeType: string;
	}): Promise<{ success: boolean; path?: string; reason?: string; error?: string }>;
}

const defaultDeps: BroadcastActionsDeps = {
	egressController: defaultEgressController,
	localRecorder: defaultLocalRecorder,
	replayBuffer: defaultReplayBuffer,
	loadChannels: defaultLoadChannels,
	resolveActiveChannels: defaultResolveActiveChannels,
	openChannelLinkDialog: defaultOpenChannelLinkDialog,
	openGoLiveFailedDialog: defaultOpenGoLiveFailedDialog,
	toast: defaultToast,
	saveRecordingRpc: (args) => defaultBunRpc.saveRecording(args),
};

export interface BroadcastActions {
	goLive(): Promise<boolean>;
	stopBroadcast(): void;
	toggleBroadcast(): Promise<void>;
	startRecording(): Promise<boolean>;
	stopRecording(): void;
	toggleRecording(): Promise<void>;
	saveReplayBufferNow(): Promise<boolean>;
}

export function createBroadcastActions(deps: BroadcastActionsDeps = defaultDeps): BroadcastActions {
	const { egressController, localRecorder, replayBuffer, loadChannels, resolveActiveChannels, openChannelLinkDialog, openGoLiveFailedDialog, toast, saveRecordingRpc } = deps;

	const goLive = async (): Promise<boolean> => {
		if (studio.state.stream.live) return true;

		const channels = loadChannels();
		let destinations: Array<{ rtmpUrl: string; streamKey: string }>;

		if (channels.length === 0) {
			const created = await openChannelLinkDialog();
			if (!created) return false;
			studio.setStream({ activeChannelIds: [created.id] });
			destinations = [{ rtmpUrl: created.rtmpUrl, streamKey: created.streamKey }];
		} else {
			const targets = resolveActiveChannels(studio.state.stream.activeChannelIds);
			if (targets.length === 0) {
				toast("Pick at least one channel in the header strip", "error");
				return false;
			}
			destinations = targets.map(({ rtmpUrl, streamKey }) => ({ rtmpUrl, streamKey }));
		}

		const count = destinations.length;
		toast(`Connecting to ${count} destination${count > 1 ? "s" : ""}…`, "info");
		try {
			await egressController.start(destinations);
			studio.setStream({ live: true });
			toast(`Live on ${count} destination${count > 1 ? "s" : ""}`, "success");
			return true;
		} catch (err) {
			const detail = err instanceof StudioError ? err.message : userMessageFor(err);
			openGoLiveFailedDialog(detail);
			return false;
		}
	};

	const stopBroadcast = (): void => {
		if (!studio.state.stream.live) return;
		egressController.stop();
		toast("Stream stopped");
	};

	const toggleBroadcast = async (): Promise<void> => {
		if (studio.state.stream.live) { stopBroadcast(); return; }
		await goLive();
	};

	const startRecording = async (): Promise<boolean> => {
		if (localRecorder.isRecording) return true;
		try {
			const started = await localRecorder.start();
			if (!started) return false;
			toast("Recording started", "success");
			return true;
		} catch (err) {
			toast(`Recording failed: ${userMessageFor(err)}`, "error");
			return false;
		}
	};

	const stopRecording = (): void => {
		if (!localRecorder.isRecording) return;
		localRecorder.stop();
	};

	const toggleRecording = async (): Promise<void> => {
		if (localRecorder.isRecording || studio.state.stream.recording) { stopRecording(); return; }
		await startRecording();
	};

	const saveReplayBufferNow = async (): Promise<boolean> => {
		if (!replayBuffer.isAttached) {
			toast("Replay buffer only runs while live", "info");
			return false;
		}
		const snap = replayBuffer.snapshot();
		if (!snap) {
			toast("Replay buffer is empty — wait a few seconds after Go Live", "info");
			return false;
		}
		try {
			const buf = await snap.blob.arrayBuffer();
			const base64 = arrayBufferToBase64(buf);
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			const result = await saveRecordingRpc({
				blobBase64: base64,
				suggestedName: `replay-${stamp}.webm`,
				mimeType: snap.mimeType,
			});
			if (result.success && result.path) {
				const mb = (snap.blob.size / (1024 * 1024)).toFixed(1);
				toast(`Replay saved: ${Math.round(snap.seconds)}s @ ${mb} MB`, "success");
				return true;
			}
			if (result.reason !== "canceled") {
				toast(`Replay save failed: ${result.error || "unknown"}`, "error");
			}
			return false;
		} catch (err) {
			toast(`Replay save failed: ${userMessageFor(err)}`, "error");
			return false;
		}
	};

	return { goLive, stopBroadcast, toggleBroadcast, startRecording, stopRecording, toggleRecording, saveReplayBufferNow };
}

// Pre-wired singleton — what every production caller uses.
const actions = createBroadcastActions();
export const goLive = (): Promise<boolean> => actions.goLive();
export const stopBroadcast = (): void => actions.stopBroadcast();
export const toggleBroadcast = (): Promise<void> => actions.toggleBroadcast();
export const startRecording = (): Promise<boolean> => actions.startRecording();
export const stopRecording = (): void => actions.stopRecording();
export const toggleRecording = (): Promise<void> => actions.toggleRecording();
export const saveReplayBufferNow = (): Promise<boolean> => actions.saveReplayBufferNow();
