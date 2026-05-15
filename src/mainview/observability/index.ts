// Public surface of the observability package. Modules under
// streaming/audio-mixer/banter/transcription import from here, not
// the individual files, so we can refactor internals freely.

export {
	type Labels,
	type MetricsCollector,
	type RingBufferOptions,
	type Snapshot,
	NoOpMetricsCollector,
	RingBufferMetricsCollector,
	metrics,
	readableMetrics,
	setMetricsCollector,
} from "./metrics";

export {
	type Fields,
	type Logger,
	currentBroadcastSessionId,
	logger,
	noopLogger,
	setBroadcastSessionId,
	setLogger,
} from "./logger";

export {
	type CheckFunc,
	type ComponentResult,
	type HealthAggregatorOptions,
	type Report,
	type Status,
	HealthAggregator,
	activeSceneNonEmptyCheck,
	audioContextCheck,
	ffmpegAliveCheck,
	health,
	setHealthAggregator,
} from "./health";

export { timed, timedSync } from "./timed";
