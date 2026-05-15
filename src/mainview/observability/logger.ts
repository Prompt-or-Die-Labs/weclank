// Structured logger — interface + ConsoleLogger + NoOp.
//
// Every log line during a broadcast carries a `broadcast_session_id`
// field, minted on Go Live, retired on Stop. Post-mortem of a botched
// stream is one grep away.
//
// Use logger() everywhere instead of console.* once a module is migrated.

export interface Logger {
	info(msg: string, fields?: Fields): void;
	warn(msg: string, fields?: Fields): void;
	error(msg: string, fields?: Fields): void;
	debug(msg: string, fields?: Fields): void;
	withField(key: string, value: unknown): Logger;
	withFields(fields: Fields): Logger;
	withError(err: unknown): Logger;
	withCorrelationId(id: string): Logger;
}

export type Fields = Record<string, unknown>;

class ConsoleLogger implements Logger {
	constructor(private readonly base: Fields = {}) {}

	private emit(level: "info" | "warn" | "error" | "debug", msg: string, fields?: Fields): void {
		const merged = { ...this.base, ...fields };
		const line = `[${level}] ${msg}`;
		const sink = level === "info" ? console.log : console[level];
		if (Object.keys(merged).length === 0) {
			sink(line);
		} else {
			sink(line, merged);
		}
	}

	info(msg: string, fields?: Fields): void { this.emit("info", msg, fields); }
	warn(msg: string, fields?: Fields): void { this.emit("warn", msg, fields); }
	error(msg: string, fields?: Fields): void { this.emit("error", msg, fields); }
	debug(msg: string, fields?: Fields): void { this.emit("debug", msg, fields); }

	withField(key: string, value: unknown): Logger {
		return new ConsoleLogger({ ...this.base, [key]: value });
	}

	withFields(fields: Fields): Logger {
		return new ConsoleLogger({ ...this.base, ...fields });
	}

	withError(err: unknown): Logger {
		const f: Fields = { err: err instanceof Error ? err.message : String(err) };
		if (err instanceof Error && err.stack) f["stack"] = err.stack;
		return new ConsoleLogger({ ...this.base, ...f });
	}

	withCorrelationId(id: string): Logger {
		return new ConsoleLogger({ ...this.base, correlation_id: id });
	}
}

class NoOpLogger implements Logger {
	info(): void {}
	warn(): void {}
	error(): void {}
	debug(): void {}
	withField(): Logger { return this; }
	withFields(): Logger { return this; }
	withError(): Logger { return this; }
	withCorrelationId(): Logger { return this; }
}

// ---------------------------------------------------------------------------
// Broadcast-session correlation. The renderer is single-threaded so a
// module-level mutable is the right primitive. Bun side should swap to
// AsyncLocalStorage when it grows concurrent sessions (not today).
// ---------------------------------------------------------------------------

let _currentBroadcastSessionId: string | undefined;

export function setBroadcastSessionId(id: string | undefined): void {
	_currentBroadcastSessionId = id;
}

export function currentBroadcastSessionId(): string | undefined {
	return _currentBroadcastSessionId;
}

// ---------------------------------------------------------------------------
// Singleton with auto-injected sessionId field.
// ---------------------------------------------------------------------------

let _logger: Logger = new ConsoleLogger();

export function setLogger(l: Logger): void {
	_logger = l;
}

export function logger(): Logger {
	const sid = _currentBroadcastSessionId;
	return sid ? _logger.withCorrelationId(sid) : _logger;
}

export const noopLogger: Logger = new NoOpLogger();
