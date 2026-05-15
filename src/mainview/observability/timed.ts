// `timed(name, fn)` — wrap a Promise-returning function with a latency
// histogram. Records `${name}_duration_ms` with an `ok=true|false` label
// based on whether the inner function resolved or rejected.
//
// No OpenTelemetry SDK weight — just emits to the metrics collector.

import { metrics } from "./metrics";

export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
	const start = performance.now();
	try {
		const v = await fn();
		metrics().recordLatency(`${name}_duration_ms`, performance.now() - start, { ok: "true" });
		return v;
	} catch (err) {
		metrics().recordLatency(`${name}_duration_ms`, performance.now() - start, { ok: "false" });
		throw err;
	}
}

export function timedSync<T>(name: string, fn: () => T): T {
	const start = performance.now();
	try {
		const v = fn();
		metrics().recordLatency(`${name}_duration_ms`, performance.now() - start, { ok: "true" });
		return v;
	} catch (err) {
		metrics().recordLatency(`${name}_duration_ms`, performance.now() - start, { ok: "false" });
		throw err;
	}
}
