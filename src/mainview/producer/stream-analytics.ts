import type { QueuedAgentAction } from "../banter/action-queue";
import type { AudienceSnapshot } from "../banter/audience-intelligence";
import type { RunOfShowState, ShowSegment } from "../core/types";
import type { TranscriptEvent } from "../transcript/feed";
import type { PostStreamOutput } from "./content-engine";

export type AnalyticsTone = "neutral" | "good" | "warning" | "danger";

export interface AnalyticsMetric {
	id: string;
	label: string;
	value: string;
	detail: string;
	tone: AnalyticsTone;
}

export interface TopicEngagement {
	segmentId: string;
	title: string;
	status: ShowSegment["status"];
	score: number;
	questions: number;
	clips: number;
	transcriptMentions: number;
}

export interface AIContributionAnalytics {
	score: number;
	queuedActions: number;
	executedActions: number;
	rejectedActions: number;
	questionsDetected: number;
	moderationFlags: number;
	transcriptEvents: number;
}

export interface StreamAnalytics {
	generatedAt: number;
	metrics: AnalyticsMetric[];
	topics: TopicEngagement[];
	aiContribution: AIContributionAnalytics;
	recommendations: string[];
}

export interface StreamAnalyticsInput {
	audience: AudienceSnapshot;
	runOfShow: RunOfShowState;
	output: PostStreamOutput;
	transcriptEvents: TranscriptEvent[];
	agentActions: QueuedAgentAction[];
	now: number;
}

export function generateStreamAnalytics(input: StreamAnalyticsInput): StreamAnalytics {
	const aiContribution = aiContributionFor(input);
	const topics = topicEngagementFor(input);
	const metrics = metricsFor(input, aiContribution);
	const recommendations = recommendationsFor(input, topics, aiContribution);
	return {
		generatedAt: input.now,
		metrics,
		topics,
		aiContribution,
		recommendations,
	};
}

function metricsFor(input: StreamAnalyticsInput, ai: AIContributionAnalytics): AnalyticsMetric[] {
	const topClip = input.output.clipCandidates[0];
	const completed = input.runOfShow.segments.filter((segment) => segment.status === "done").length;
	const total = input.runOfShow.segments.length;
	const highFlags = input.audience.flags.filter((flag) => flag.severity === "high").length;
	return [
		{
			id: "chat-velocity",
			label: "Chat velocity",
			value: `${input.audience.chatVelocity}/min`,
			detail: `${input.audience.messageCount} recent message${input.audience.messageCount === 1 ? "" : "s"} tracked`,
			tone: input.audience.chatVelocity >= 20 ? "good" : input.audience.chatVelocity >= 5 ? "neutral" : "warning",
		},
		{
			id: "sentiment",
			label: "Sentiment",
			value: input.audience.sentiment.label,
			detail: `${input.audience.sentiment.positive} positive, ${input.audience.sentiment.negative} negative`,
			tone: input.audience.sentiment.label === "positive" ? "good" : input.audience.sentiment.label === "negative" ? "warning" : "neutral",
		},
		{
			id: "questions",
			label: "Questions",
			value: String(input.audience.questions.length),
			detail: input.audience.questions.length > 0 ? "Review before ending or exporting recap" : "No open viewer questions",
			tone: input.audience.questions.length > 0 ? "warning" : "neutral",
		},
		{
			id: "clip-potential",
			label: "Clip potential",
			value: topClip ? String(topClip.score) : "0",
			detail: topClip ? topClip.title : "No high-signal clip candidate yet",
			tone: topClip && topClip.score >= 72 ? "good" : topClip ? "neutral" : "warning",
		},
		{
			id: "run-progress",
			label: "Run progress",
			value: `${completed}/${total}`,
			detail: total > 0 ? "Completed planned segments" : "No run-of-show segments",
			tone: total > 0 && completed === total ? "good" : "neutral",
		},
		{
			id: "moderation",
			label: "Moderation",
			value: String(input.audience.flags.length),
			detail: highFlags > 0 ? `${highFlags} high severity flag${highFlags === 1 ? "" : "s"}` : "No high severity flags",
			tone: highFlags > 0 ? "danger" : input.audience.flags.length > 0 ? "warning" : "good",
		},
		{
			id: "ai-score",
			label: "AI contribution",
			value: String(ai.score),
			detail: `${ai.executedActions} executed action${ai.executedActions === 1 ? "" : "s"}, ${ai.transcriptEvents} transcript event${ai.transcriptEvents === 1 ? "" : "s"}`,
			tone: ai.score >= 70 ? "good" : ai.score >= 35 ? "neutral" : "warning",
		},
	];
}

function topicEngagementFor(input: StreamAnalyticsInput): TopicEngagement[] {
	return input.runOfShow.segments.map((segment) => {
		const words = keywordSet(segment.title);
		const questions = input.audience.questions.filter((question) => overlaps(words, question.text)).length;
		const clips = input.output.clipCandidates.filter((clip) => overlaps(words, clip.title) || overlaps(words, clip.reason)).length;
		const transcriptMentions = input.transcriptEvents.filter((event) => overlaps(words, event.summary)).length;
		const statusBonus = segment.status === "done" ? 20 : segment.status === "live" ? 14 : 4;
		const score = Math.min(100, statusBonus + questions * 18 + clips * 16 + transcriptMentions * 10);
		return {
			segmentId: segment.id,
			title: segment.title,
			status: segment.status,
			score,
			questions,
			clips,
			transcriptMentions,
		};
	}).sort((a, b) => b.score - a.score);
}

function aiContributionFor(input: StreamAnalyticsInput): AIContributionAnalytics {
	const queuedActions = input.agentActions.filter((action) => action.status === "pending").length;
	const executedActions = input.agentActions.filter((action) => action.status === "executed" || action.status === "approved").length;
	const rejectedActions = input.agentActions.filter((action) => action.status === "rejected").length;
	const score = Math.min(100, Math.round(
		executedActions * 14
		+ input.audience.questions.length * 7
		+ input.audience.flags.length * 4
		+ input.transcriptEvents.length * 2
		+ input.output.clipCandidates.length * 5
		- rejectedActions * 4,
	));
	return {
		score: Math.max(0, score),
		queuedActions,
		executedActions,
		rejectedActions,
		questionsDetected: input.audience.questions.length,
		moderationFlags: input.audience.flags.length,
		transcriptEvents: input.transcriptEvents.length,
	};
}

function recommendationsFor(
	input: StreamAnalyticsInput,
	topics: TopicEngagement[],
	ai: AIContributionAnalytics,
): string[] {
	const recommendations: string[] = [];
	if (input.audience.questions.length > 0) {
		recommendations.push("Answer or pin unresolved viewer questions before publishing the recap.");
	}
	if (!input.output.clipCandidates[0]) {
		recommendations.push("Mark a highlight or enable richer transcript context to improve clip candidates.");
	}
	if (input.audience.sentiment.label === "negative") {
		recommendations.push("Slow down and ask the audience what is confusing before moving to the next segment.");
	}
	if (ai.queuedActions > 0) {
		recommendations.push("Review pending AI actions in the producer tray before ending the stream.");
	}
	if (topics[0] && topics[0].score >= 60) {
		recommendations.push(`Turn "${topics[0].title}" into the first short-form export.`);
	}
	if (recommendations.length === 0) {
		recommendations.push("Keep the current format. Add a product or Q&A segment if monetization is a goal.");
	}
	return recommendations.slice(0, 5);
}

function keywordSet(text: string): Set<string> {
	return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4));
}

function overlaps(words: Set<string>, text: string): boolean {
	if (words.size === 0) return false;
	const lower = text.toLowerCase();
	for (const word of words) {
		if (lower.includes(word)) return true;
	}
	return false;
}
