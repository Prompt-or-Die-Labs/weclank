// Participant runtime — per CONTEXT.md, the disposable resources attached
// to a participant: media streams, TTS providers, audio mixer inputs,
// renderers, and banter sessions.
//
// Before this module: each call site in source-factory.ts re-implemented
// its own cleanup callback, listing the relevant subsystems for that
// kind of participant. The cleanup logic was duplicated across three
// places; adding a participant kind meant updating every one.
//
// After: one module owns the runtime lifecycle. Callers declare WHAT
// resources are attached (`attach({participantId, mediaStream, hasVoiceRoute, …})`)
// and the module knows HOW to tear them all down in `dispose(id)`. The
// studio store's per-participant cleanup callback becomes
// `() => participantRuntime.dispose(id)`.

import { audioMixer } from "../streaming/audio-mixer";
import { banterEngine } from "../banter/banter-engine";
import { disposeVoiceRoute } from "../tts/registry";
import type { ParticipantId } from "../core/ids";

interface RuntimeRecord {
	/** Tracks to stop on dispose (camera / screen / mic getUserMedia streams). */
	mediaStream?: MediaStream;
	/** `blob:` URL to revoke on dispose (VRM / GLB model picks). */
	blobModelUrl?: string;
	/** Dispose TTS provider + remove its mixer input. Agents only. */
	hasVoiceRoute: boolean;
	/** Remove mixer input directly. Used for non-agent audio sources
	 * (camera w/ paired mic, standalone mic). Mutually exclusive with
	 * hasVoiceRoute — voice routes manage their own mixer input. */
	hasMixerInput: boolean;
	/** Stop the participant's banter session. Agents and text assistants. */
	hasBanterSession: boolean;
	/** Dispose the participant's offscreen renderer. Anyone with a visual
	 * surface — humans + voice agents. Text assistants have no renderer. */
	hasRenderer: boolean;
}

export interface AttachOptions {
	mediaStream?: MediaStream;
	blobModelUrl?: string;
	hasVoiceRoute?: boolean;
	hasMixerInput?: boolean;
	hasBanterSession?: boolean;
	hasRenderer?: boolean;
}

class ParticipantRuntime {
	private records = new Map<ParticipantId, RuntimeRecord>();

	/** Record the resources attached to this participant. Idempotent —
	 * calling twice merges (later attaches add to the existing record). */
	attach(id: ParticipantId, opts: AttachOptions): void {
		const existing = this.records.get(id);
		const next: RuntimeRecord = {
			mediaStream: opts.mediaStream ?? existing?.mediaStream,
			blobModelUrl: opts.blobModelUrl ?? existing?.blobModelUrl,
			hasVoiceRoute: opts.hasVoiceRoute ?? existing?.hasVoiceRoute ?? false,
			hasMixerInput: opts.hasMixerInput ?? existing?.hasMixerInput ?? false,
			hasBanterSession: opts.hasBanterSession ?? existing?.hasBanterSession ?? false,
			hasRenderer: opts.hasRenderer ?? existing?.hasRenderer ?? false,
		};
		this.records.set(id, next);
	}

	/** Tear down everything recorded for this participant. Runs in reverse
	 * dependency order: banter (uses TTS) → voice route / mixer → media
	 * tracks → blob URLs → renderer. Safe to call when no record exists. */
	async dispose(id: ParticipantId): Promise<void> {
		const record = this.records.get(id);
		if (!record) return;
		this.records.delete(id);

		// 1. Stop the banter session first — it may try to speak through
		//    the TTS provider we're about to dispose.
		if (record.hasBanterSession) {
			try { banterEngine.stop(id); } catch (err) { console.warn("[runtime] banter stop failed", id, err); }
		}

		// 2. Dispose TTS provider + its mixer input. For non-agent audio
		//    sources, just remove the mixer input directly.
		if (record.hasVoiceRoute) {
			try { disposeVoiceRoute(id); } catch (err) { console.warn("[runtime] voice route dispose failed", id, err); }
		} else if (record.hasMixerInput) {
			try { audioMixer.removeInput(id); } catch (err) { console.warn("[runtime] mixer removeInput failed", id, err); }
		}

		// 3. Stop any media tracks held for this participant.
		if (record.mediaStream) {
			for (const track of record.mediaStream.getTracks()) {
				try { track.stop(); } catch { /* noop */ }
			}
		}

		// 4. Revoke blob URLs created at attach time.
		if (record.blobModelUrl?.startsWith("blob:")) {
			try { URL.revokeObjectURL(record.blobModelUrl); } catch { /* noop */ }
		}

		// 5. Dispose the renderer last — once it's gone, no more frames
		//    composite. Dynamic import keeps renderer-farm out of Bun-side
		//    tests that touch the runtime registry transitively.
		if (record.hasRenderer) {
			try {
				const { rendererFarm } = await import("../components/renderer-farm");
				rendererFarm.dispose(id);
			} catch (err) {
				console.warn("[runtime] renderer dispose failed", id, err);
			}
		}
	}

	/** Test surface: which participants currently have a runtime record. */
	attachedIds(): ParticipantId[] {
		return Array.from(this.records.keys()) as ParticipantId[];
	}

	/** Test surface: peek at what was recorded for a participant. */
	peek(id: ParticipantId): Readonly<RuntimeRecord> | undefined {
		return this.records.get(id);
	}

	/** Test hook — drop all records without running disposers. */
	_resetForTesting(): void {
		this.records.clear();
	}
}

export const participantRuntime = new ParticipantRuntime();
