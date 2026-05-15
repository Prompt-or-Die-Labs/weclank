// Background music channel — a single MediaStreamDestinationNode in the
// shared audio mixer context that any caller (agent tool, manual UI) can
// push audio into. The mixer treats it like any other input so the
// resulting mix is what the egress pipeline records.
//
// Music is intentionally a global resource, not per-agent: only one track
// at a time, with a shared volume knob. Switching tracks crossfades for
// 800ms so transitions don't pop.

import { audioMixer } from "./audio-mixer";
import { ApiError } from "../core/errors";

const MIXER_ID = "__music__";
const CROSSFADE_MS = 800;

interface ActiveSource {
	source: AudioBufferSourceNode;
	gain: GainNode;
}

class MusicPlayer {
	private destination = audioMixer.ctx.createMediaStreamDestination();
	private trunkGain = audioMixer.ctx.createGain();
	private active: ActiveSource | null = null;
	private registered = false;
	private volume = 0.4;

	constructor() {
		this.trunkGain.gain.value = this.volume;
		this.trunkGain.connect(this.destination);
	}

	get currentVolume(): number {
		return this.volume;
	}

	setVolume(v: number): void {
		const clamped = Math.max(0, Math.min(1.5, v));
		this.volume = clamped;
		// Smooth, not zippered — audible jumps when the LLM nudges volume
		// otherwise.
		const ctx = audioMixer.ctx;
		this.trunkGain.gain.linearRampToValueAtTime(clamped, ctx.currentTime + 0.15);
	}

	async playFromArrayBuffer(buffer: ArrayBuffer, loop = false): Promise<void> {
		await audioMixer.resume();
		// decodeAudioData consumes its input on some implementations.
		// slice() to keep the caller's buffer reusable.
		const decoded = await audioMixer.ctx.decodeAudioData(buffer.slice(0));
		this.swapTo(decoded, loop);
	}

	async playFromUrl(url: string, loop = false): Promise<void> {
		const response = await fetch(url);
		if (!response.ok) throw new ApiError(response.status, "Music", "fetch failed");
		const buffer = await response.arrayBuffer();
		await this.playFromArrayBuffer(buffer, loop);
	}

	stop(): void {
		if (!this.active) return;
		const dying = this.active;
		this.active = null;
		const ctx = audioMixer.ctx;
		const releaseAt = ctx.currentTime + CROSSFADE_MS / 1000;
		dying.gain.gain.cancelScheduledValues(ctx.currentTime);
		dying.gain.gain.setValueAtTime(dying.gain.gain.value, ctx.currentTime);
		dying.gain.gain.linearRampToValueAtTime(0, releaseAt);
		setTimeout(() => {
			try { dying.source.stop(); } catch { /* noop */ }
			try { dying.source.disconnect(); } catch { /* noop */ }
			try { dying.gain.disconnect(); } catch { /* noop */ }
		}, CROSSFADE_MS + 50);
	}

	private swapTo(buffer: AudioBuffer, loop: boolean): void {
		const ctx = audioMixer.ctx;
		this.ensureMixerInput();

		const fadeEnd = ctx.currentTime + CROSSFADE_MS / 1000;
		const next: ActiveSource = {
			source: ctx.createBufferSource(),
			gain: ctx.createGain(),
		};
		next.source.buffer = buffer;
		next.source.loop = loop;
		next.gain.gain.setValueAtTime(0, ctx.currentTime);
		next.gain.gain.linearRampToValueAtTime(1, fadeEnd);
		next.source.connect(next.gain);
		next.gain.connect(this.trunkGain);
		next.source.start();

		if (this.active) {
			const dying = this.active;
			dying.gain.gain.cancelScheduledValues(ctx.currentTime);
			dying.gain.gain.setValueAtTime(dying.gain.gain.value, ctx.currentTime);
			dying.gain.gain.linearRampToValueAtTime(0, fadeEnd);
			setTimeout(() => {
				try { dying.source.stop(); } catch { /* noop */ }
				try { dying.source.disconnect(); } catch { /* noop */ }
				try { dying.gain.disconnect(); } catch { /* noop */ }
			}, CROSSFADE_MS + 50);
		}

		this.active = next;
		next.source.onended = (): void => {
			if (this.active === next) this.active = null;
		};
	}

	/** Lazy: only attach the music channel to the mixer once we actually
	 * have something to play. Otherwise it'd quietly add an empty channel
	 * to the broadcast mix from the moment the studio starts. */
	private ensureMixerInput(): void {
		if (this.registered) return;
		// Music files (Suno-generated) are pre-mastered; bypass the
		// compressor/limiter chain so we don't double-compress.
		audioMixer.addInput(MIXER_ID, this.destination.stream, { bypassFilters: true });
		this.registered = true;
	}
}

export const musicPlayer = new MusicPlayer();

/** Boot-time resume: if persisted state has a track with a remote URL,
 * re-fetch and play. Blob URLs (which die at page unload) get cleared.
 * Must be called after a user gesture so AudioContext.resume() succeeds. */
export async function resumeMusicOnBoot(): Promise<void> {
	const { studio } = await import("../state/studio-store");
	const track = studio.state.music.current;
	if (!track || !track.url) return;
	if (track.url.startsWith("blob:")) {
		studio.setCurrentMusic(null);
		return;
	}
	try {
		musicPlayer.setVolume(studio.state.music.volume);
		await musicPlayer.playFromUrl(track.url, false);
		// Refresh startedAt so the HUD's "now playing" age is accurate.
		studio.setCurrentMusic({ ...track, startedAt: Date.now() });
	} catch (err) {
		console.warn("[music] resume failed; clearing persisted track", err);
		studio.setCurrentMusic(null);
	}
}
