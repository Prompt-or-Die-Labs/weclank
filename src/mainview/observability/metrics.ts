// Metrics collector — interface + RealImpl + NoOp triplet.
//
// Every observability subsystem in the studio holds this interface and
// trusts the impl. Call sites never null-check. The singleton defaults
// to the in-memory RingBuffer so the perf HUD just works; tests can
// swap to NoOp via setMetricsCollector(new NoOpMetricsCollector()).
//
// Auto-registration on first use eliminates the "where do I declare
// this counter" question — call `incrementCounter("egress_chunks_total",
// {dest: "twitch"})` from anywhere and it materializes the series on
// first touch.

export type Labels = Record<string, string>;

export interface MetricsCollector {
	incrementCounter(name: string, labels?: Labels): void;
	addCounter(name: string, value: number, labels?: Labels): void;
	recordLatency(name: string, durationMs: number, labels?: Labels): void;
	recordValue(name: string, value: number, labels?: Labels): void;
	setGauge(name: string, value: number, labels?: Labels): void;
}

// ---------------------------------------------------------------------------
// NoOp — safe default for tests.
// ---------------------------------------------------------------------------

export class NoOpMetricsCollector implements MetricsCollector {
	incrementCounter(_name: string, _labels?: Labels): void {}
	addCounter(_name: string, _value: number, _labels?: Labels): void {}
	recordLatency(_name: string, _durationMs: number, _labels?: Labels): void {}
	recordValue(_name: string, _value: number, _labels?: Labels): void {}
	setGauge(_name: string, _value: number, _labels?: Labels): void {}
}

// ---------------------------------------------------------------------------
// RingBuffer — what the perf HUD reads from. In-memory, bounded.
// ---------------------------------------------------------------------------

interface CounterSeries {
	kind: "counter";
	values: number[]; // running total per sample
}

interface HistogramSeries {
	kind: "histogram";
	values: number[]; // each observation
}

interface GaugeSeries {
	kind: "gauge";
	current: number;
}

type Series = CounterSeries | HistogramSeries | GaugeSeries;

export interface RingBufferOptions {
	/** Max samples retained per series. Default 600 — at 1Hz that's 10 min. */
	historyDepth?: number;
}

function seriesKey(name: string, labels?: Labels): string {
	if (!labels || Object.keys(labels).length === 0) return name;
	const sorted = Object.keys(labels)
		.sort()
		.map((k) => `${k}=${labels[k]}`)
		.join(",");
	return `${name}{${sorted}}`;
}

export class RingBufferMetricsCollector implements MetricsCollector {
	private readonly series = new Map<string, Series>();
	private readonly historyDepth: number;

	constructor(opts: RingBufferOptions = {}) {
		this.historyDepth = opts.historyDepth ?? 600;
	}

	incrementCounter(name: string, labels?: Labels): void {
		this.addCounter(name, 1, labels);
	}

	addCounter(name: string, value: number, labels?: Labels): void {
		const k = seriesKey(name, labels);
		const s = this.series.get(k);
		if (!s || s.kind !== "counter") {
			this.series.set(k, { kind: "counter", values: [value] });
			return;
		}
		const last = s.values[s.values.length - 1] ?? 0;
		s.values.push(last + value);
		if (s.values.length > this.historyDepth) s.values.shift();
	}

	recordLatency(name: string, durationMs: number, labels?: Labels): void {
		this.recordValue(name, durationMs, labels);
	}

	recordValue(name: string, value: number, labels?: Labels): void {
		const k = seriesKey(name, labels);
		const s = this.series.get(k);
		if (!s || s.kind !== "histogram") {
			this.series.set(k, { kind: "histogram", values: [value] });
			return;
		}
		s.values.push(value);
		if (s.values.length > this.historyDepth) s.values.shift();
	}

	setGauge(name: string, value: number, labels?: Labels): void {
		const k = seriesKey(name, labels);
		this.series.set(k, { kind: "gauge", current: value });
	}

	// ---- read API used by the perf HUD ----

	keys(): string[] {
		return Array.from(this.series.keys());
	}

	snapshot(name: string, labels?: Labels): Snapshot | undefined {
		const s = this.series.get(seriesKey(name, labels));
		if (!s) return undefined;
		if (s.kind === "gauge") return { kind: "gauge", current: s.current };
		if (s.kind === "counter") {
			const total = s.values[s.values.length - 1] ?? 0;
			return { kind: "counter", total };
		}
		// histogram — compute p50/p95/p99
		const sorted = [...s.values].sort((a, b) => a - b);
		const n = sorted.length;
		const pick = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))] ?? 0;
		return {
			kind: "histogram",
			count: n,
			p50: pick(0.5),
			p95: pick(0.95),
			p99: pick(0.99),
			max: sorted[n - 1] ?? 0,
		};
	}
}

export type Snapshot =
	| { kind: "counter"; total: number }
	| { kind: "gauge"; current: number }
	| { kind: "histogram"; count: number; p50: number; p95: number; p99: number; max: number };

// ---------------------------------------------------------------------------
// Singleton — defaults to RingBuffer so the perf HUD just works.
// Tests can call setMetricsCollector(new NoOpMetricsCollector()).
// ---------------------------------------------------------------------------

let _metrics: MetricsCollector = new RingBufferMetricsCollector();

export function setMetricsCollector(c: MetricsCollector): void {
	_metrics = c;
}

export function metrics(): MetricsCollector {
	return _metrics;
}

/** Type-guard for read access. The RingBuffer impl exposes `snapshot()`
 *  and `keys()` beyond the write interface; the perf HUD uses these. */
export function readableMetrics(): RingBufferMetricsCollector | undefined {
	return _metrics instanceof RingBufferMetricsCollector ? _metrics : undefined;
}
