// AgentRenderer: strategy interface for whatever visually represents a
// participant inside a ParticipantTile. Each kind (camera/screen/voice/
// voice-image/voice-vrm/voice-glb) implements it.
//
// Lifecycle:
//   attach(host) – inject DOM/canvas into the host element
//   update(participant) – react to participant-state changes (mute, status…)
//   detach() – stop streams, dispose three.js, etc.
//
// Renderers may consume audio for reactive visuals. The tile passes an
// AnalyserNode rather than the raw stream so the audio mixer stays the single
// owner of the WebAudio graph.

import type { Participant, SourceKind } from "../core/types";

export interface RendererContext {
	/** Element where the renderer should mount its visuals. */
	host: HTMLElement;
	/** Voice analyser, present when the participant emits audio. */
	analyser?: AnalyserNode;
	/** Called once the renderer has produced its first frame. */
	onReady?: () => void;
}

export interface AgentRenderer {
	readonly kind: SourceKind;
	attach(ctx: RendererContext, participant: Participant): Promise<void>;
	update(participant: Participant): void;
	detach(): void;
	/** Captures the current frame as an image source for stream compositing. */
	getFrameSource(): CanvasImageSource | null;
}
