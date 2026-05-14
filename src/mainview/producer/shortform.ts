import type { ClipCandidate, PostStreamOutput } from "./content-engine";
import type { StreamAnalytics } from "./stream-analytics";

export type ShortExportPresetId = "tiktok" | "reels" | "shorts";
export type CaptionStyleId = "clean" | "punch" | "karaoke" | "podcast";

export interface ShortExportPreset {
	id: ShortExportPresetId;
	label: string;
	size: string;
	targetLength: string;
	videoBitrate: string;
	audioBitrate: string;
}

export interface CaptionStyle {
	id: CaptionStyleId;
	label: string;
	useCase: string;
	highlight: string;
}

export interface ViralityBreakdown {
	hook: number;
	engagement: number;
	value: number;
	shareability: number;
	total: number;
	hookType: "question" | "statement" | "story" | "contrast" | "none";
	reason: string;
}

export interface ShortFormClipPlan {
	title: string;
	source: ClipCandidate["source"];
	reason: string;
	timecode?: string;
	score: number;
	preset: ShortExportPresetId;
	captionStyle: CaptionStyleId;
	brollPrompts: string[];
	virality: ViralityBreakdown;
}

export interface ShortFormPackage {
	exportPresets: ShortExportPreset[];
	captionStyles: CaptionStyle[];
	clips: ShortFormClipPlan[];
	productionNotes: string[];
}

export const SHORT_EXPORT_PRESETS: ShortExportPreset[] = [
	{ id: "tiktok", label: "TikTok", size: "1080x1920", targetLength: "25-50s", videoBitrate: "10M", audioBitrate: "192k" },
	{ id: "reels", label: "Reels", size: "1080x1920", targetLength: "25-50s", videoBitrate: "12M", audioBitrate: "192k" },
	{ id: "shorts", label: "Shorts", size: "1080x1920", targetLength: "25-50s", videoBitrate: "10M", audioBitrate: "192k" },
];

export const SHORT_CAPTION_STYLES: CaptionStyle[] = [
	{ id: "clean", label: "Clean", useCase: "Default readable recap captions", highlight: "#FFFFFF" },
	{ id: "punch", label: "Punch", useCase: "High-energy demo or reveal moments", highlight: "#FFB800" },
	{ id: "karaoke", label: "Karaoke", useCase: "Word-synced spoken clips", highlight: "#DD5E2E" },
	{ id: "podcast", label: "Podcast", useCase: "Calm Q&A and explanation clips", highlight: "#D6DAC8" },
];

export function generateShortFormPackage(output: PostStreamOutput, analytics: StreamAnalytics): ShortFormPackage {
	const clips = output.clipCandidates.slice(0, 5).map((clip, index) => clipPlanFor(clip, analytics, index));
	return {
		exportPresets: SHORT_EXPORT_PRESETS,
		captionStyles: SHORT_CAPTION_STYLES,
		clips,
		productionNotes: productionNotesFor(output, clips),
	};
}

function clipPlanFor(clip: ClipCandidate, analytics: StreamAnalytics, index: number): ShortFormClipPlan {
	const virality = viralityFor(clip, analytics, index);
	return {
		title: clip.title,
		source: clip.source,
		reason: clip.reason,
		timecode: clip.timecode,
		score: clip.score,
		preset: presetFor(clip),
		captionStyle: captionStyleFor(clip, virality),
		brollPrompts: brollPromptsFor(clip),
		virality,
	};
}

function viralityFor(clip: ClipCandidate, analytics: StreamAnalytics, index: number): ViralityBreakdown {
	const title = clip.title.toLowerCase();
	const reason = clip.reason.toLowerCase();
	const questionHook = title.includes("?") || title.startsWith("viewer asks");
	const demoHook = /\b(demo|reveal|launch|fixed|built|passed|error)\b/.test(title);
	const topicBoost = analytics.topics[0] && overlapsWords(analytics.topics[0].title, clip.title) ? 4 : 0;
	const base = Math.max(0, Math.min(100, clip.score - index * 2));
	const hook = clamp(Math.round(base * 0.2) + (questionHook ? 6 : demoHook ? 4 : 1), 0, 25);
	const engagement = clamp(Math.round(base * 0.22) + (clip.source === "audience" ? 4 : 2), 0, 25);
	const value = clamp(Math.round(base * 0.2) + (reason.includes("tool") || reason.includes("process") ? 5 : topicBoost), 0, 25);
	const shareability = clamp(Math.round(base * 0.21) + (clip.score >= 72 ? 4 : 1), 0, 25);
	const total = clamp(hook + engagement + value + shareability, 0, 100);
	return {
		hook,
		engagement,
		value,
		shareability,
		total,
		hookType: hookTypeFor(clip),
		reason: total >= 75
			? "Strong enough to lead the short-form queue."
			: "Usable clip candidate; tighten the open before publishing.",
	};
}

function presetFor(clip: ClipCandidate): ShortExportPresetId {
	if (clip.source === "audience") return "reels";
	if (clip.source === "run") return "shorts";
	return "tiktok";
}

function captionStyleFor(clip: ClipCandidate, virality: ViralityBreakdown): CaptionStyleId {
	if (clip.source === "audience") return "podcast";
	if (virality.hookType === "statement" || virality.total >= 78) return "punch";
	if (clip.source === "transcript") return "karaoke";
	return "clean";
}

function brollPromptsFor(clip: ClipCandidate): string[] {
	const terms = keywords(`${clip.title} ${clip.reason}`).slice(0, 3);
	if (terms.length === 0) return ["coding stream workspace", "software demo screen"];
	return terms.map((term) => `${term} visual`);
}

function hookTypeFor(clip: ClipCandidate): ViralityBreakdown["hookType"] {
	const title = clip.title.toLowerCase();
	if (title.includes("?") || title.startsWith("viewer asks")) return "question";
	if (/\b(before|after|versus|vs|instead)\b/.test(title)) return "contrast";
	if (/\b(story|when|today)\b/.test(title)) return "story";
	if (/\b(launch|fixed|built|passed|error|reveal|demo)\b/.test(title)) return "statement";
	return "none";
}

function productionNotesFor(output: PostStreamOutput, clips: ShortFormClipPlan[]): string[] {
	if (clips.length === 0) {
		return ["Mark highlights or capture richer transcript context before exporting shorts."];
	}
	return [
		`Lead with "${clips[0]!.title}" and keep the first cut inside 25-50 seconds.`,
		"Export 1080x1920 H.264/AAC with faststart for TikTok, Reels, and Shorts.",
		output.unansweredQuestions.length > 0
			? "Turn unresolved viewer questions into Q&A follow-up shorts."
			: "Use transcript-driven clips first; no unresolved Q&A was captured.",
	];
}

function keywords(text: string): string[] {
	const stop = new Set(["again", "built", "candidate", "clip", "contains", "high", "moment", "question", "ready", "reason", "segment", "signal", "source", "stream", "transcript", "viewer"]);
	return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/))]
		.filter((word) => word.length >= 4 && !stop.has(word));
}

function overlapsWords(a: string, b: string): boolean {
	const haystack = b.toLowerCase();
	return keywords(a).some((word) => haystack.includes(word));
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
