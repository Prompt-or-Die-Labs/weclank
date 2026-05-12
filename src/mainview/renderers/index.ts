// Renderer factory. ParticipantTile asks for a renderer matching the kind;
// swapping a participant's kind tears down the old renderer and builds a new
// one of the right type.

import type { AgentRenderer } from "./renderer";
import type { SourceKind } from "../core/types";
import { CameraRenderer } from "./camera-renderer";
import { ScreenRenderer } from "./screen-renderer";
import { MicRenderer } from "./mic-renderer";
import { VoiceRenderer } from "./voice-renderer";
import { ImageRenderer } from "./image-renderer";
import { VRMRenderer } from "./vrm-renderer";
import { GLBRenderer } from "./glb-renderer";

export function createRenderer(kind: SourceKind): AgentRenderer {
	switch (kind) {
		case "camera":
			return new CameraRenderer();
		case "screen":
			return new ScreenRenderer();
		case "mic":
			return new MicRenderer();
		case "voice":
			return new VoiceRenderer();
		case "voice-image":
			return new ImageRenderer();
		case "voice-vrm":
			return new VRMRenderer();
		case "voice-glb":
			return new GLBRenderer();
		case "text":
			throw new Error("Text assistants have no canvas renderer");
	}
}

export type { AgentRenderer } from "./renderer";
