// Audio mixer: single owner of the WebAudio graph. Every participant routes
// audio (mic for humans, TTS output for agents) through here so renderers
// get a stable AnalyserNode and the stream output gets a single mixed
// track.
//
// Inputs can be either MediaStream (camera/mic) or an AudioNode that
// already lives in the mixer's context (TTS providers). Keeping a single
// AudioContext avoids the latency / sample-rate-mismatch issues that come
// from connecting nodes across contexts.

import { metrics } from "../observability";
import { createFilterChain, type FilterChain } from "./audio-filters";

interface Channel {
	source: AudioNode;
	filters: FilterChain;
	delay: DelayNode;
	gain: GainNode;
	analyser: AnalyserNode;
	ownsSource: boolean; // disconnect on remove?
}

export interface AddInputOptions {
	/** Skip the whole filter chain — appropriate for already-mastered
	 *  sources like TTS providers and pre-rendered music. Default
	 *  false (filters applied). */
	bypassFilters?: boolean;
	/** Insert the noise-gate worklet ahead of compressor/limiter.
	 *  Defaults to true for MediaStream sources (mics/cameras) and
	 *  false for AudioNode sources (TTS providers, music). */
	noiseGate?: boolean;
	/** Per-source sync offset in milliseconds. Positive values delay
	 *  this channel relative to others (e.g., +120ms to compensate
	 *  for a slow Bluetooth mic). Negative values can't go backwards
	 *  in time, so for "make agent TTS feel earlier" the right move
	 *  is to delay the OTHER channels by +120ms each, not -120ms on
	 *  this one. Default 0. */
	syncOffsetMs?: number;
}

export class AudioMixer {
	readonly ctx: AudioContext;
	private destination: MediaStreamAudioDestinationNode;
	private channels = new Map<string, Channel>();

	constructor() {
		this.ctx = new AudioContext();
		this.destination = this.ctx.createMediaStreamDestination();
	}

	get outputStream(): MediaStream {
		return this.destination.stream;
	}

	resume(): Promise<void> {
		return this.ctx.resume();
	}

	addInput(participantId: string, source: MediaStream | AudioNode, opts: AddInputOptions = {}): AnalyserNode {
		this.removeInput(participantId);
		let sourceNode: AudioNode;
		let ownsSource = false;
		if (source instanceof MediaStream) {
			sourceNode = this.ctx.createMediaStreamSource(source);
			ownsSource = true;
		} else {
			sourceNode = source;
		}

		// Source → filters (optional gate → compressor → limiter, OBS
		// defaults) → delay → gain → analyser → destination. TTS
		// providers can bypass filters since their output is already
		// mastered. Noise gate defaults ON for mic sources (MediaStream),
		// OFF for node sources (TTS/music).
		const noiseGate = opts.noiseGate ?? (ownsSource && !opts.bypassFilters);
		const filters = createFilterChain(this.ctx, {
			bypass: opts.bypassFilters,
			noiseGate,
		});
		// DelayNode in seconds; maxDelayTime caps at 1s (more than
		// anyone would need to compensate for Bluetooth or codec lag).
		const delay = this.ctx.createDelay(1);
		const offsetMs = Math.max(0, Math.min(1000, opts.syncOffsetMs ?? 0));
		delay.delayTime.value = offsetMs / 1000;
		const gain = this.ctx.createGain();
		gain.gain.value = 1;
		const analyser = this.ctx.createAnalyser();
		analyser.fftSize = 2048;
		analyser.smoothingTimeConstant = 0.6;

		sourceNode.connect(filters.input);
		filters.output.connect(delay);
		delay.connect(gain);
		gain.connect(analyser);
		analyser.connect(this.destination);

		this.channels.set(participantId, { source: sourceNode, filters, delay, gain, analyser, ownsSource });
		metrics().incrementCounter("audio_mixer_channels_added_total", {
			kind: ownsSource ? "media-stream" : "audio-node",
			filters: opts.bypassFilters ? "bypass" : "applied",
		});
		metrics().setGauge("audio_mixer_channels_active", this.channels.size);
		if (offsetMs > 0) {
			metrics().setGauge("audio_mixer_channel_sync_offset_ms", offsetMs, { id: participantId });
		}
		return analyser;
	}

	/** Live-update the per-channel sync offset. Clamped to [0, 1000]ms. */
	setSyncOffset(participantId: string, offsetMs: number): void {
		const ch = this.channels.get(participantId);
		if (!ch) return;
		const clamped = Math.max(0, Math.min(1000, offsetMs));
		ch.delay.delayTime.value = clamped / 1000;
		metrics().setGauge("audio_mixer_channel_sync_offset_ms", clamped, { id: participantId });
	}

	getSyncOffset(participantId: string): number {
		const ch = this.channels.get(participantId);
		return ch ? ch.delay.delayTime.value * 1000 : 0;
	}

	getAnalyser(participantId: string): AnalyserNode | undefined {
		return this.channels.get(participantId)?.analyser;
	}

	setGain(participantId: string, value: number): void {
		const ch = this.channels.get(participantId);
		if (ch) ch.gain.gain.value = value;
	}

	mute(participantId: string, muted: boolean): void {
		this.setGain(participantId, muted ? 0 : 1);
	}

	/** True when a channel is connected and has a non-zero gain. Used by
	 * the mixer strip's VU + slider state. */
	hasChannel(participantId: string): boolean {
		return this.channels.has(participantId);
	}

	getGain(participantId: string): number {
		return this.channels.get(participantId)?.gain.gain.value ?? 0;
	}

	/** All currently-routed participant ids. */
	channelIds(): string[] {
		return Array.from(this.channels.keys());
	}

	removeInput(participantId: string): void {
		const ch = this.channels.get(participantId);
		if (!ch) return;
		// Only disconnect nodes we created here. Caller-provided AudioNodes
		// (TTS provider outputs) are owned by the provider; disconnecting
		// them would tear down its internal graph.
		if (ch.ownsSource) ch.source.disconnect();
		else ch.source.disconnect(ch.filters.input);
		ch.filters.dispose();
		ch.delay.disconnect();
		ch.gain.disconnect();
		ch.analyser.disconnect();
		this.channels.delete(participantId);
		metrics().incrementCounter("audio_mixer_channels_removed_total");
		metrics().setGauge("audio_mixer_channels_active", this.channels.size);
	}

	dispose(): void {
		for (const id of this.channels.keys()) this.removeInput(id);
		void this.ctx.close();
	}
}

export const audioMixer = new AudioMixer();
