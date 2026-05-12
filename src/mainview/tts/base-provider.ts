// Shared mechanics for every TTS backend. Subclasses implement
// synthesize(text) returning raw audio bytes + a mime hint; this base
// handles decoding, scheduling on the shared AudioContext, and lifecycle.

import { audioMixer } from "../streaming/audio-mixer";
import type { TTSProvider } from "./provider";

export interface SynthesisResult {
	bytes: ArrayBuffer;
	mimeType?: string; // unused at decode time, but useful for diagnostics
}

export abstract class BaseTTSProvider implements TTSProvider {
	abstract readonly id: string;

	private destination = audioMixer.ctx.createMediaStreamDestination();
	private active: AudioBufferSourceNode | null = null;

	getStream(): MediaStream {
		return this.destination.stream;
	}

	async speak(text: string): Promise<void> {
		// AudioContext requires a user gesture before the first sound plays;
		// resume() is idempotent and cheap when already running.
		await audioMixer.resume();
		this.stop();
		const result = await this.synthesize(text);
		// decodeAudioData mutates its input on some engines; clone to a
		// detached ArrayBuffer so retrying with the same bytes is safe.
		const buffer = await audioMixer.ctx.decodeAudioData(result.bytes.slice(0));
		const source = audioMixer.ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(this.destination);
		source.onended = (): void => {
			if (this.active === source) this.active = null;
		};
		source.start();
		this.active = source;
	}

	stop(): void {
		if (!this.active) return;
		try {
			this.active.stop();
		} catch {
			// already stopped — ignore
		}
		this.active = null;
	}

	dispose(): void {
		this.stop();
		this.destination.disconnect();
	}

	protected abstract synthesize(text: string): Promise<SynthesisResult>;
}
