// Error class hierarchy. Every thrown error in the studio should be a
// subclass of `StudioError` so the UI layer can decide what to surface.
//
// The split between `.message` (developer / log) and `.userMessage`
// (toast / dialog) keeps stack-trace text out of the UI without losing
// debugging info. `toast(err)` reads `userMessage`; `console.warn(err)`
// reads `message`.

export class StudioError extends Error {
	readonly userMessage: string;
	constructor(message: string, userMessage?: string) {
		super(message);
		this.name = new.target.name;
		this.userMessage = userMessage ?? message;
	}
}

/** HTTP / remote-API failure. Includes status + which service so the toast
 * can say "ElevenLabs request failed (HTTP 429)" without exposing URL. */
export class ApiError extends StudioError {
	readonly status: number;
	readonly service: string;
	readonly body: string;
	constructor(status: number, service: string, body: string) {
		const trimmed = body.slice(0, 200);
		super(
			`${service} HTTP ${status}: ${trimmed || "no body"}`,
			friendlyApiMessage(service, status),
		);
		this.status = status;
		this.service = service;
		this.body = trimmed;
	}
}

/** Configuration is invalid or missing. */
export class ConfigError extends StudioError {}

/** Audio mixer, WebAudio context, capture path. */
export class AudioError extends StudioError {}

/** Renderer (camera, screen, voice-*) failed to attach or update. */
export class RendererError extends StudioError {}

/** IPC between Bun and the webview. */
export class IpcError extends StudioError {}

/** Account / login / signup failure. */
export class AuthError extends StudioError {}

/** Database / local-storage / migration failure. */
export class PersistenceError extends StudioError {}

/** Tool-call invocation rejected at the boundary (bad args from the LLM). */
export class ToolInvocationError extends StudioError {}

function friendlyApiMessage(service: string, status: number): string {
	if (status === 401 || status === 403) {
		return `${service} rejected the API key. Open Voice settings and re-check it.`;
	}
	if (status === 429) {
		return `${service} is rate-limiting — wait a moment and try again.`;
	}
	if (status >= 500) {
		return `${service} is having a bad day (HTTP ${status}). Try again shortly.`;
	}
	return `${service} request failed (HTTP ${status}).`;
}

/** Convenience: pick the right message for toasts. Always returns a string. */
export function userMessageFor(err: unknown): string {
	if (err instanceof StudioError) return err.userMessage;
	if (err instanceof Error) return err.message;
	return String(err);
}
