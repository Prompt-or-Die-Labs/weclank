// Base class for TTS providers that stream PCM16 chunks rather than
// downloading a whole audio buffer before playback. Subclasses implement
// `synthesizeStreaming(text, onPCM16, signal)` which is expected to call
// `onPCM16` with each chunk as it arrives. The signal aborts in-flight
// network calls when `stop()` is invoked or another `speak()` starts.

import { audioMixer } from "../streaming/audio-mixer";
import type { TTSProvider } from "./provider";
import { StreamingAudioScheduler } from "./streaming-scheduler";

export abstract class StreamingTTSProvider implements TTSProvider {
	abstract readonly id: string;

	private destination = audioMixer.ctx.createMediaStreamDestination();
	private scheduler: StreamingAudioScheduler;
	private activeAbort: AbortController | null = null;

	constructor(sampleRate: number) {
		this.scheduler = new StreamingAudioScheduler(audioMixer.ctx, this.destination, sampleRate);
	}

	getStream(): MediaStream {
		return this.destination.stream;
	}

	async speak(text: string): Promise<void> {
		await audioMixer.resume();
		this.stop();
		const ctrl = new AbortController();
		this.activeAbort = ctrl;
		try {
			await this.synthesizeStreaming(text, (pcm) => this.scheduler.appendPCM16(pcm), ctrl.signal);
		} finally {
			if (this.activeAbort === ctrl) this.activeAbort = null;
		}
	}

	stop(): void {
		this.activeAbort?.abort();
		this.activeAbort = null;
		this.scheduler.stop();
	}

	dispose(): void {
		this.stop();
		this.destination.disconnect();
	}

	protected abstract synthesizeStreaming(
		text: string,
		onChunk: (pcm: Int16Array) => void,
		signal: AbortSignal,
	): Promise<void>;
}

/** Decode a base64 string to Int16Array of little-endian PCM samples. */
export function base64ToPCM16(b64: string): Int16Array {
	const binary = atob(b64);
	const buf = new ArrayBuffer(binary.length);
	const u8 = new Uint8Array(buf);
	for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
	// View the same ArrayBuffer as Int16 little-endian. JavaScript's
	// typed-array views are platform-endian (always LE on x86/ARM); for
	// strict portability we'd read with DataView, but LE machines are the
	// universe here.
	return new Int16Array(buf);
}
