// OmniVoice TTS provider — invokes the `omnivoice` carrot's synthesize
// method over RPC, decodes the returned base64 WAV, and plays it through
// the shared audio mixer like every other buffered provider.
//
// No API key. No network call. The carrot must be installed + enabled
// (Settings → Carrots → install from <repo>/carrots/omnivoice).

import { BaseTTSProvider, type SynthesisResult } from "./base-provider";
import { ApiError, ConfigError } from "../core/errors";
import { bunRpc } from "../rpc";

const CARROT_ID = "omnivoice";

export interface OmniVoiceTTSOptions {
	/** Style instruction passed to the model (e.g. "calm narrator"). */
	instruct?: string;
	/** Language label (defaults to "None" in the binary). */
	lang?: string;
	/** Reserved — voice selection now requires a reference WAV +
	 * transcript via the upstream `--ref-wav` / `--ref-text` flags.
	 * Plain voice-name selection was removed from omnivoice-tts. */
	voice?: string;
}

export class OmniVoiceTTSProvider extends BaseTTSProvider {
	readonly id = "omnivoice";
	private instruct: string | undefined;
	private lang: string | undefined;

	constructor(opts?: OmniVoiceTTSOptions) {
		super();
		this.instruct = opts?.instruct;
		this.lang = opts?.lang;
	}

	protected async synthesize(text: string): Promise<SynthesisResult> {
		const res = await bunRpc.carrotInvoke({
			id: CARROT_ID,
			method: "synthesize",
			params: { text, instruct: this.instruct, lang: this.lang },
			timeoutMs: 60_000,
		});
		if (!res.ok) {
			const msg = res.error ?? "OmniVoice synthesize failed";
			if (/not built|not running|not installed|missing|disabled/i.test(msg)) {
				throw new ConfigError(
					msg,
					"Open Voice settings for this agent and finish OmniVoice setup — the inline checklist installs the carrot, points at the binary, and downloads the model weights.",
				);
			}
			throw new ApiError(0, "OmniVoice", msg);
		}
		const payload = res.payload as { base64?: string; mimeType?: string; byteLength?: number } | null;
		if (!payload?.base64) throw new ApiError(0, "OmniVoice", "carrot returned no audio data");
		const bytes = base64ToArrayBuffer(payload.base64);
		return { bytes, mimeType: payload.mimeType ?? "audio/wav" };
	}
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
	const binary = atob(b64);
	const len = binary.length;
	const buf = new ArrayBuffer(len);
	const view = new Uint8Array(buf);
	for (let i = 0; i < len; i++) view[i] = binary.charCodeAt(i);
	return buf;
}
