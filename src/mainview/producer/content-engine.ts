import type { AudienceSnapshot } from "../banter/audience-intelligence";
import type { RunOfShowState, ShowSegment } from "../core/types";
import type { TranscriptEvent } from "../transcript/feed";
import { segmentTiming } from "./run-of-show";

export interface ContentEngineInput {
	streamTitle: string;
	runOfShow: RunOfShowState;
	audience: AudienceSnapshot;
	transcriptEvents: TranscriptEvent[];
	now: number;
}

export interface ChapterMarker {
	timecode: string;
	title: string;
	status: ShowSegment["status"];
}

export interface ClipCandidate {
	title: string;
	source: "transcript" | "audience" | "run";
	reason: string;
	score: number;
	timecode?: string;
}

export interface PostStreamOutput {
	generatedAt: number;
	title: string;
	summary: string[];
	chapters: ChapterMarker[];
	clipCandidates: ClipCandidate[];
	unansweredQuestions: string[];
	followUpTopics: string[];
	newsletter: string;
	socialPosts: string[];
	sponsorReport: string[];
	moderationReport: string[];
}

const CLIP_KEYWORDS = [
	"announce",
	"built",
	"demo",
	"error",
	"fixed",
	"highlight",
	"launch",
	"passed",
	"question",
	"reveal",
	"shipped",
	"wow",
];

const STOP_WORDS = new Set([
	"about",
	"after",
	"again",
	"with",
	"from",
	"that",
	"this",
	"what",
	"when",
	"where",
	"which",
	"would",
	"could",
	"should",
	"there",
	"their",
	"your",
	"have",
	"just",
	"stream",
	"viewer",
	"asked",
]);

export function generatePostStreamOutput(input: ContentEngineInput): PostStreamOutput {
	const title = cleanTitle(input.streamTitle);
	const chapters = chapterMarkers(input.runOfShow, input.now);
	const unansweredQuestions = input.audience.questions
		.slice(0, 8)
		.map((question) => `${question.author}: ${question.text}`);
	const followUpTopics = topicSuggestions(input.transcriptEvents, input.audience.questions.map((question) => question.text));
	const clipCandidates = clipCandidatesFor(input, chapters);
	const summary = summaryFor(input, title, chapters, clipCandidates);
	const sponsorReport = sponsorReportFor(input);
	const moderationReport = moderationReportFor(input.audience);
	return {
		generatedAt: input.now,
		title,
		summary,
		chapters,
		clipCandidates,
		unansweredQuestions,
		followUpTopics,
		newsletter: newsletterFor(title, summary, followUpTopics, unansweredQuestions),
		socialPosts: socialPostsFor(title, summary, clipCandidates),
		sponsorReport,
		moderationReport,
	};
}

function summaryFor(
	input: ContentEngineInput,
	title: string,
	chapters: ChapterMarker[],
	clips: ClipCandidate[],
): string[] {
	const liveCount = input.runOfShow.segments.filter((segment) => segment.status === "done" || segment.status === "live").length;
	const mood = input.audience.sentiment.label;
	const transcriptCount = input.transcriptEvents.length;
	const output = [
		`${title} covered ${liveCount || chapters.length} planned segment${(liveCount || chapters.length) === 1 ? "" : "s"} with ${mood} audience sentiment.`,
		transcriptCount > 0
			? `${transcriptCount} transcript event${transcriptCount === 1 ? "" : "s"} were captured for recap and editing.`
			: "No transcript events were captured yet, so the recap is based on show plan and chat signals.",
	];
	if (input.audience.questions.length > 0) {
		output.push(`${input.audience.questions.length} viewer question${input.audience.questions.length === 1 ? "" : "s"} should be reviewed before publishing follow-up content.`);
	}
	if (clips[0]) {
		output.push(`Top clip candidate: ${clips[0].title}.`);
	}
	return output;
}

function chapterMarkers(runOfShow: RunOfShowState, now: number): ChapterMarker[] {
	let plannedOffset = 0;
	return runOfShow.segments.map((segment) => {
		const marker = {
			timecode: formatTimecode(plannedOffset),
			title: segment.title,
			status: segment.status,
		};
		const timing = segmentTiming(segment, now);
		plannedOffset += segment.status === "live" ? Math.max(segment.durationSec, timing.elapsedSec) : segment.durationSec;
		return marker;
	});
}

function clipCandidatesFor(input: ContentEngineInput, chapters: ChapterMarker[]): ClipCandidate[] {
	const transcriptClips = input.transcriptEvents
		.map((event, index) => transcriptClip(event, index))
		.filter((clip): clip is ClipCandidate => clip !== null);
	const audienceClips = input.audience.questions.slice(0, 4).map((question, index) => ({
		title: shorten(`Viewer asks: ${question.text}`, 72),
		source: "audience" as const,
		reason: "Viewer question can become a Q&A short.",
		score: 70 - index * 4,
	}));
	const runClips = chapters
		.filter((chapter) => chapter.status === "live" || chapter.status === "done")
		.slice(0, 3)
		.map((chapter, index) => ({
			title: shorten(`${chapter.title} segment`, 72),
			source: "run" as const,
			reason: "Completed run-of-show segment is ready for chapter export.",
			score: 58 - index * 3,
			timecode: chapter.timecode,
		}));
	return [...transcriptClips, ...audienceClips, ...runClips]
		.sort((a, b) => b.score - a.score)
		.slice(0, 8);
}

function transcriptClip(event: TranscriptEvent, index: number): ClipCandidate | null {
	const text = event.summary.trim();
	if (!text) return null;
	const lower = text.toLowerCase();
	const keywordHits = CLIP_KEYWORDS.filter((keyword) => lower.includes(keyword)).length;
	const toolBonus = event.kind === "assistant_tool" ? 8 : 0;
	const score = 48 + keywordHits * 12 + toolBonus - Math.min(index, 12);
	if (score < 56) return null;
	return {
		title: shorten(text, 72),
		source: "transcript",
		reason: keywordHits > 0 ? "Transcript contains a high-signal moment." : "Tool activity can anchor a process clip.",
		score,
	};
}

function topicSuggestions(events: TranscriptEvent[], questions: string[]): string[] {
	const terms = new Map<string, number>();
	for (const text of [...events.map((event) => event.summary), ...questions]) {
		for (const word of words(text)) {
			terms.set(word, (terms.get(word) ?? 0) + 1);
		}
	}
	const topics = [...terms.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 6)
		.map(([word]) => titleCase(word));
	return topics.length > 0 ? topics : ["Audience Q&A", "Behind the scenes", "Next stream preview"];
}

function sponsorReportFor(input: ContentEngineInput): string[] {
	const sponsorSegments = input.runOfShow.segments.filter((segment) => /sponsor|product|pricing|demo|offer|sale/i.test(segment.title));
	const commerceQuestions = input.audience.questions.filter((question) => /price|pricing|buy|cost|plan|product|link|discount/i.test(question.text));
	if (sponsorSegments.length === 0 && commerceQuestions.length === 0) {
		return ["No sponsor or product segment detected.", "Add a sponsor/product run segment to track offer timing and unanswered buyer questions."];
	}
	return [
		`${sponsorSegments.length} sponsor/product segment${sponsorSegments.length === 1 ? "" : "s"} appeared in the run-of-show.`,
		`${commerceQuestions.length} commerce-adjacent viewer question${commerceQuestions.length === 1 ? "" : "s"} should be answered or routed to a product card.`,
	];
}

function moderationReportFor(audience: AudienceSnapshot): string[] {
	if (audience.flags.length === 0) return ["No moderation flags were captured."];
	const high = audience.flags.filter((flag) => flag.severity === "high").length;
	const kinds = [...new Set(audience.flags.map((flag) => flag.kind))].join(", ");
	return [
		`${audience.flags.length} moderation flag${audience.flags.length === 1 ? "" : "s"} captured across ${kinds}.`,
		high > 0 ? `${high} high-severity item${high === 1 ? "" : "s"} should be reviewed before publishing chat excerpts.` : "No high-severity moderation items captured.",
	];
}

function newsletterFor(title: string, summary: string[], topics: string[], questions: string[]): string {
	const questionBlock = questions.length > 0
		? questions.slice(0, 4).map((question) => `- ${question}`).join("\n")
		: "- No open questions captured.";
	return [
		`Subject: Recap - ${title}`,
		"",
		`Today on ${title}:`,
		...summary.map((line) => `- ${line}`),
		"",
		"Next topics:",
		...topics.slice(0, 4).map((topic) => `- ${topic}`),
		"",
		"Unanswered questions:",
		questionBlock,
	].join("\n");
}

function socialPostsFor(title: string, summary: string[], clips: ClipCandidate[]): string[] {
	const firstSummary = summary[0] ?? `${title} wrapped with fresh stream notes.`;
	const topClip = clips[0]?.title ?? "the best live moment";
	return [
		shorten(`${title} recap: ${firstSummary}`, 220),
		shorten(`Clip this: ${topClip}. Full recap and chapter notes are ready in Weclank.`, 220),
		shorten(`Post-stream queue: summary, questions, clips, sponsor notes, and follow-ups are drafted for ${title}.`, 220),
	];
}

function words(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
}

function cleanTitle(title: string): string {
	const trimmed = title.replace(/\s+/g, " ").trim();
	return trimmed || "Untitled stream";
}

function shorten(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, Math.max(0, limit - 1)).trim()}...`;
}

function titleCase(text: string): string {
	return text.slice(0, 1).toUpperCase() + text.slice(1);
}

function formatTimecode(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const secs = whole % 60;
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
