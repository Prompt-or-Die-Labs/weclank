// Weclank carrot runtime — types.
//
// A "carrot" is a sandboxed background plug-in: a `carrot.json` manifest +
// a `worker.mjs` entry point. The host spawns it as a child Bun process
// with a filtered env and capability-restricted FS access. The carrot
// talks back over JSON-over-stdio (call/response RPC).
//
// Shipped capabilities:
//   - subprocess isolation
//   - background-mode worker (always required)
//   - optional window-mode HTML view (manifest.view)
//   - local-dir install + remote zip/tar.gz install (carrotInstallFromUrl)
//   - permission consent + intersect-on-install
//   - SQLite-backed registry (~/Library/Application Support/Weclank/studio.db)
//   - dev hot reload (fs.watch on the carrot source dir, debounced restart)
//   - auto-download of model artifacts when the carrot prepares itself
//
// Deliberately deferred (kept simple, easy to add later):
//   - shared-worker isolation: subprocess is sufficient for our use cases
//     (TTS engines, model servers) and gives strong isolation guarantees;
//     a Worker thread shares the host's heap and OS handles, which
//     undermines the sandbox we want for third-party carrots.
//   - carrot → carrot dependencies: we don't have a graph resolver, and
//     forcing each carrot to be self-contained keeps the install consent
//     legible — users see exactly what they're granting per carrot.
//
// We are intentionally not depending on Milady or any external runtime;
// every binary, model, and config lives under either the repo
// (`carrots/*`) or the user's `~/.weclank/` tree.

/** Permissions exposed to a carrot's worker process. */
export const BUN_PERMISSIONS = ["read", "write", "env", "run", "ffi"] as const;

/** Permissions that need host-side coordination. */
export const HOST_PERMISSIONS = ["storage", "notifications"] as const;

/** How the carrot worker runs. v1 supports `subprocess` only. */
export const CARROT_ISOLATIONS = ["subprocess"] as const;

export type BunPermission = (typeof BUN_PERMISSIONS)[number];
export type HostPermission = (typeof HOST_PERMISSIONS)[number];
export type CarrotIsolation = (typeof CARROT_ISOLATIONS)[number];

export type CarrotPermissionTag =
	| `host:${HostPermission}`
	| `bun:${BunPermission}`
	| `isolation:${CarrotIsolation}`;

export interface CarrotPermissionGrant {
	host?: Partial<Record<HostPermission, boolean>>;
	bun?: Partial<Record<BunPermission, boolean>>;
	isolation?: CarrotIsolation;
}

export interface CarrotViewManifest {
	/** Relative path under the carrot dir, e.g. "view/index.html". */
	relativePath: string;
	/** Window title shown in the OS chrome. */
	title?: string;
	/** Initial window size in CSS pixels. */
	width?: number;
	height?: number;
	/** macOS-only title bar style. */
	titleBarStyle?: "hidden" | "hiddenInset" | "default";
}

export interface CarrotManifest {
	/** Stable lower-kebab id (`omnivoice-tts`). Used as the storage key. */
	id: string;
	/** Display name. */
	name: string;
	/** Semantic version. */
	version: string;
	/** One-line description shown in the install consent dialog. */
	description: string;
	/** Optional longer copy shown on the carrot detail panel. */
	long_description?: string;
	/** Permissions the carrot requests. The user grants a subset. */
	permissions: CarrotPermissionGrant;
	/** Relative path (under the carrot's source dir) to the entry .mjs file
	 * the host spawns with `bun run`. */
	worker: { relativePath: string };
	/** Optional: when set, the carrot can request a window be opened
	 * showing its HTML view. The view talks to the worker over the same
	 * RPC channel (via host → worker invoke). */
	view?: CarrotViewManifest;
	/** Optional public-facing URL shown in the carrot panel. */
	homepage?: string;
}

/** Stored alongside the manifest after install: which permissions the user
 * actually granted, and the source directory where the carrot files live. */
export interface InstalledCarrot {
	id: string;
	manifest: CarrotManifest;
	sourcePath: string;
	enabled: boolean;
	granted: CarrotPermissionGrant;
	installedAt: number;
	updatedAt: number;
}

/** Bootstrap blob the host injects into the carrot process before its
 * worker.mjs runs. Available as `globalThis.__weclankCarrotBootstrap`. */
export interface CarrotRuntimeContext {
	manifest: CarrotManifest;
	/** Permissions actually granted (subset of manifest.permissions). */
	granted: CarrotPermissionGrant;
	/** Absolute path the carrot may write its state to (JSON, SQLite, …). */
	statePath: string;
	/** Absolute path the carrot may append logs to. */
	logsPath: string;
	/** Channel / build label. Mirrors Milady's bootstrap field name. */
	channel: "dev" | "canary" | "release";
}

// ── RPC wire format (JSON-over-stdio) ──────────────────────────────────

/** Worker → host: ask the host to do something (and reply). */
export interface HostRequestMessage {
	type: "host-request";
	requestId: number;
	method: string;
	params?: unknown;
}

/** Host → worker: response to a HostRequestMessage. */
export interface HostResponseMessage {
	type: "host-response";
	requestId: number;
	success: boolean;
	payload?: unknown;
	error?: string;
}

/** Worker → host: fire-and-forget action (logging, notifications). */
export interface HostActionMessage {
	type: "action";
	action: string;
	payload?: unknown;
}

/** Host → worker: invoke a named method on the worker. */
export interface WorkerInvokeMessage {
	type: "invoke";
	requestId: number;
	method: string;
	params?: unknown;
}

/** Worker → host: response to WorkerInvokeMessage. */
export interface WorkerInvokeResponse {
	type: "invoke-response";
	requestId: number;
	success: boolean;
	payload?: unknown;
	error?: string;
}

export type CarrotInboundMessage = WorkerInvokeMessage | HostResponseMessage;
export type CarrotOutboundMessage = HostRequestMessage | HostActionMessage | WorkerInvokeResponse;

// ── Consent ────────────────────────────────────────────────────────────

export interface CarrotConsentRequest {
	carrotId: string;
	carrotName: string;
	version: string;
	description: string;
	/** All permission tags the manifest asked for. */
	requestedPermissions: CarrotPermissionTag[];
}
