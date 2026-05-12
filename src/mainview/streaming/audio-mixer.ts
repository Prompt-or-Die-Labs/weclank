// Audio mixer: single owner of the WebAudio graph. Every participant routes
// audio (mic for humans, TTS output for agents) through here so renderers
// get a stable AnalyserNode and the stream output gets a single mixed
// track.
//
// Inputs can be either MediaStream (camera/mic) or an AudioNode that
// already lives in the mixer's context (TTS providers). Keeping a single
// AudioContext avoids the latency / sample-rate-mismatch issues that come
// from connecting nodes across contexts.

interface Channel {
	source: AudioNode;
	gain: GainNode;
	analyser: AnalyserNode;
	ownsSource: boolean; // disconnect on remove?
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

	addInput(participantId: string, source: MediaStream | AudioNode): AnalyserNode {
		this.removeInput(participantId);
		let sourceNode: AudioNode;
		let ownsSource = false;
		if (source instanceof MediaStream) {
			sourceNode = this.ctx.createMediaStreamSource(source);
			ownsSource = true;
		} else {
			sourceNode = source;
		}
		const gain = this.ctx.createGain();
		gain.gain.value = 1;
		const analyser = this.ctx.createAnalyser();
		analyser.fftSize = 2048;
		analyser.smoothingTimeConstant = 0.6;

		sourceNode.connect(gain);
		gain.connect(analyser);
		analyser.connect(this.destination);

		this.channels.set(participantId, { source: sourceNode, gain, analyser, ownsSource });
		return analyser;
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
		else ch.source.disconnect(ch.gain);
		ch.gain.disconnect();
		ch.analyser.disconnect();
		this.channels.delete(participantId);
	}

	dispose(): void {
		for (const id of this.channels.keys()) this.removeInput(id);
		void this.ctx.close();
	}
}

export const audioMixer = new AudioMixer();
