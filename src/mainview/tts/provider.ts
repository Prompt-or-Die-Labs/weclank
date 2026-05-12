// TTSProvider — shared contract for every speech backend.
//
// Each provider owns a MediaStreamAudioDestinationNode inside the shared
// AudioMixer context; calling speak() decodes synthesized audio and
// schedules it on that destination. The participant tile feeds the
// destination's MediaStream into the mixer, which gives the renderer an
// AnalyserNode for lip-sync and the speaking-ring loop in the tool rail.

export interface TTSProvider {
	readonly id: string;
	/** Speak the given text. Resolves when the audio is queued (not when it
	 * finishes playing). Throws on synthesis failure. */
	speak(text: string): Promise<void>;
	/** Stop any in-flight playback. Safe to call when idle. */
	stop(): void;
	/** Audio output as a MediaStream; route into the mixer. */
	getStream(): MediaStream;
	dispose(): void;
}
