// Global test setup. Registers happy-dom so DOM-touching imports
// (modules that read `localStorage`, construct `MediaStream`, etc.) load
// without throwing. Plus stubs for the few browser globals happy-dom
// doesn't provide that our modules touch at import time.
//
// Happy-dom isn't a full browser — there's no real video pipeline, no
// WebGL. Tests that need those mock locally. This just stops imports
// from blowing up.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof window === "undefined") {
	GlobalRegistrator.register();
}

// MediaStream stub — fallback when happy-dom doesn't provide one. When
// happy-dom IS loaded, its real MediaStream wins and the destination
// stub below uses `new MediaStream()` so `instanceof MediaStream` checks
// in audio-mixer pass for TTS provider streams.
class StubMediaStream {
	getAudioTracks(): unknown[] { return []; }
	getTracks(): unknown[] { return []; }
}
if (typeof globalThis.MediaStream === "undefined") {
	(globalThis as unknown as { MediaStream: typeof StubMediaStream }).MediaStream = StubMediaStream;
}

// AudioContext stub — `audio-mixer.ts` constructs one at module load.
// Tests that exercise actual audio routing mock more comprehensively in
// the test file itself (see `tts/streaming-scheduler.test.ts`).
class StubAudioNode {
	connect(): StubAudioNode { return this; }
	disconnect(): void {}
}
class StubAudioContext extends StubAudioNode {
	currentTime = 0;
	state: "suspended" | "running" | "closed" = "running";
	destination = new StubAudioNode();
	createMediaStreamDestination(): { stream: MediaStream } & StubAudioNode {
		// IMPORTANT: use the real (happy-dom) MediaStream so consumers'
		// `source instanceof MediaStream` checks in audio-mixer succeed.
		return Object.assign(new StubAudioNode(), { stream: new MediaStream() });
	}
	createMediaStreamSource(): StubAudioNode { return new StubAudioNode(); }
	createGain(): StubAudioNode & { gain: { value: number } } {
		return Object.assign(new StubAudioNode(), { gain: { value: 1 } });
	}
	createAnalyser(): StubAudioNode & { fftSize: number; smoothingTimeConstant: number; frequencyBinCount: number; getByteFrequencyData(): void } {
		return Object.assign(new StubAudioNode(), {
			fftSize: 2048,
			smoothingTimeConstant: 0.6,
			frequencyBinCount: 1024,
			getByteFrequencyData(): void {},
		});
	}
	createBuffer(_channels: number, length: number, sampleRate: number): { duration: number; copyToChannel(): void } {
		return { duration: length / sampleRate, copyToChannel(): void {} };
	}
	createBufferSource(): StubAudioNode & { buffer: unknown; start(): void; stop(): void; onended: null } {
		return Object.assign(new StubAudioNode(), { buffer: null, start(): void {}, stop(): void {}, onended: null });
	}
	createDynamicsCompressor(): StubAudioNode & {
		threshold: { value: number };
		knee: { value: number };
		ratio: { value: number };
		attack: { value: number };
		release: { value: number };
	} {
		return Object.assign(new StubAudioNode(), {
			threshold: { value: 0 },
			knee: { value: 0 },
			ratio: { value: 0 },
			attack: { value: 0 },
			release: { value: 0 },
		});
	}
	createDelay(_maxDelayTime?: number): StubAudioNode & { delayTime: { value: number } } {
		return Object.assign(new StubAudioNode(), { delayTime: { value: 0 } });
	}
	resume(): Promise<void> { return Promise.resolve(); }
	close(): Promise<void> { return Promise.resolve(); }
	get audioWorklet(): { addModule(): Promise<void> } {
		return { addModule: () => Promise.resolve() };
	}
}
if (typeof globalThis.AudioContext === "undefined") {
	(globalThis as unknown as { AudioContext: typeof StubAudioContext }).AudioContext = StubAudioContext;
}

// AudioWorkletNode stub — modules that try to construct worklets at
// load time (e.g. audio-filters with noise gate) need this so they
// don't blow up before the bypass-fallback kicks in. In real tests
// of the worklet itself, mock at the test site.
class StubAudioWorkletNode extends StubAudioNode {
	parameters = new Map<string, { value: number }>();
	port = { postMessage(): void {}, close(): void {}, onmessage: null as unknown };
}
if (typeof globalThis.AudioWorkletNode === "undefined") {
	(globalThis as unknown as { AudioWorkletNode: typeof StubAudioWorkletNode }).AudioWorkletNode = StubAudioWorkletNode;
	void 0;
}

// Electrobun preload — the real one runs before the renderer JS loads
// and injects `window.__electrobun` with IPC plumbing. In tests we stub
// it with no-op pumps so rpc.ts can instantiate `new Electroview(...)`
// without throwing at module load.
interface ElectrobunStub {
	receiveMessageFromBun?: (...args: unknown[]) => void;
	receiveInternalMessageFromBun?: (...args: unknown[]) => void;
	[key: string]: unknown;
}
if (!(window as unknown as { __electrobun?: ElectrobunStub }).__electrobun) {
	(window as unknown as { __electrobun: ElectrobunStub }).__electrobun = {
		receiveMessageFromBun: () => {},
		receiveInternalMessageFromBun: () => {},
		sendMessageToBun: () => {},
	};
}

