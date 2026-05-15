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
// Side effects (toasts, dialogs) stay inside the actions; callers
// don't need to know about UI primitives.

import { studio } from "../state/studio-store";
import { egressController } from "./egress";
import { localRecorder } from "./recorder";
import { replayBuffer } from "./replay-buffer";
import { loadChannels, resolveActiveChannels } from "./channels";
import { openChannelLinkDialog } from "./channel-link-dialog";
import { openGoLiveFailedDialog } from "../components/go-live-failed-dialog";
import { toast } from "../components/overlays";
import { StudioError, userMessageFor } from "../core/errors";
import { bunRpc } from "../rpc";
import { arrayBufferToBase64 } from "./base64";

/** Resolve channels + open the first-time-link dialog if needed, then
 *  attach the egressController. Returns true when the stream actually
 *  started; false if the user cancelled mid-flow or no destinations
 *  were available. */
export async function goLive(): Promise<boolean> {
	if (studio.state.stream.live) return true; // already live — caller can treat as success

	const channels = loadChannels();
	let destinations: Array<{ rtmpUrl: string; streamKey: string }>;

	if (channels.length === 0) {
		// First-time path — link a channel, then use it.
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
}

/** Stop the broadcast. Idempotent — no-op if not live. */
export function stopBroadcast(): void {
	if (!studio.state.stream.live) return;
	egressController.stop();
	toast("Stream stopped");
}

/** Toggle live: stop if running, otherwise go through goLive. */
export async function toggleBroadcast(): Promise<void> {
	if (studio.state.stream.live) {
		stopBroadcast();
		return;
	}
	await goLive();
}

/** Start local recording. Returns true on success, false on cancel.
 *  Errors are surfaced via toast. */
export async function startRecording(): Promise<boolean> {
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
}

/** Stop local recording. Idempotent. */
export function stopRecording(): void {
	if (!localRecorder.isRecording) return;
	localRecorder.stop();
}

/** Toggle recording: stop if running, otherwise start. */
export async function toggleRecording(): Promise<void> {
	if (localRecorder.isRecording || studio.state.stream.recording) {
		stopRecording();
		return;
	}
	await startRecording();
}

/** Snapshot the replay buffer to disk via the save-recording dialog.
 *  Returns true if a file was actually written. */
export async function saveReplayBufferNow(): Promise<boolean> {
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
		const result = await bunRpc.saveRecording({
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
}
