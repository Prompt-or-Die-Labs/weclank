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
	createMediaStreamDestination(): { stream: { getAudioTracks(): unknown[] } } & StubAudioNode {
		return Object.assign(new StubAudioNode(), { stream: { getAudioTracks: () => [] } });
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
	resume(): Promise<void> { return Promise.resolve(); }
	close(): Promise<void> { return Promise.resolve(); }
	get audioWorklet(): { addModule(): Promise<void> } {
		return { addModule: () => Promise.resolve() };
	}
}
if (typeof globalThis.AudioContext === "undefined") {
	(globalThis as unknown as { AudioContext: typeof StubAudioContext }).AudioContext = StubAudioContext;
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

// MediaStream stub — referenced as a type at runtime in audio-mixer's
// instanceof check.
class StubMediaStream {
	getAudioTracks(): unknown[] { return []; }
	getTracks(): unknown[] { return []; }
}
if (typeof globalThis.MediaStream === "undefined") {
	(globalThis as unknown as { MediaStream: typeof StubMediaStream }).MediaStream = StubMediaStream;
}
