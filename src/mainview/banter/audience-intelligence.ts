import type { ChatMessage } from "./chat-source";

export type AudienceSentiment = "positive" | "neutral" | "negative";
export type AudienceFlagKind = "spam" | "link" | "toxicity" | "caps";
export type AudienceFlagSeverity = "low" | "medium" | "high";

export interface AudienceQuestion {
	id: string;
	author: string;
	text: string;
	timestamp: number;
}

export interface AudienceFlag {
	id: string;
	author: string;
	text: string;
	timestamp: number;
	kind: AudienceFlagKind;
	reason: string;
	severity: AudienceFlagSeverity;
}

export interface AudienceSnapshot {
	messageCount: number;
	chatVelocity: number;
	sentiment: {
		positive: number;
		neutral: number;
		negative: number;
		label: AudienceSentiment;
	};
	questions: AudienceQuestion[];
	flags: AudienceFlag[];
	lastUpdated: number;
}

interface AudienceMessage extends ChatMessage {
	normalized: string;
	sentiment: AudienceSentiment;
}

type AudienceListener = (snapshot: AudienceSnapshot) => void;

const MAX_MESSAGES = 240;
const MAX_QUESTIONS = 30;
const MAX_FLAGS = 30;
const VELOCITY_WINDOW_MS = 60_000;
const SENTIMENT_WINDOW_MS = 5 * 60_000;
const DUPLICATE_WINDOW_MS = 30_000;

const QUESTION_PREFIXES = [
	"what",
	"why",
	"how",
	"when",
	"where",
	"who",
	"can",
	"could",
	"should",
	"would",
	"is",
	"are",
	"do",
	"does",
	"did",
	"will",
];

const POSITIVE_TERMS = [
	"amazing",
	"awesome",
	"based",
	"cool",
	"fire",
	"good",
	"great",
	"haha",
	"hype",
	"love",
	"nice",
	"thanks",
	"thank",
	"win",
	"yes",
];

const NEGATIVE_TERMS = [
	"awful",
	"bad",
	"boring",
	"broken",
	"bug",
	"confused",
	"crash",
	"hate",
	"lag",
	"laggy",
	"no",
	"stuck",
	"terrible",
	"wrong",
];

const TOXIC_TERMS = [
	"idiot",
	"shut up",
	"stupid",
	"trash",
];

class AudienceIntelligence {
	private messages: AudienceMessage[] = [];
	private questions: AudienceQuestion[] = [];
	private flags: AudienceFlag[] = [];
	private listeners: AudienceListener[] = [];
	private lastUpdated = 0;

	recordMessage(message: ChatMessage): AudienceSnapshot {
		const text = normalizeText(message.text);
		if (!text) return this.snapshot();
		const timestamp = finiteTimestamp(message.timestamp);
		const normalized = text.toLowerCase();
		const entry: AudienceMessage = {
			...message,
			text,
			timestamp,
			normalized,
			sentiment: sentimentFor(normalized),
		};
		this.messages = [...this.messages, entry].slice(-MAX_MESSAGES);
		this.lastUpdated = timestamp;
		const question = questionFor(entry);
		if (question) this.addQuestion(question);
		const flag = flagFor(entry, this.messages);
		if (flag) this.addFlag(flag);
		this.emit();
		return this.snapshot();
	}

	snapshot(): AudienceSnapshot {
		const now = this.lastUpdated || Date.now();
		const recentVelocity = this.messages.filter((message) => now - message.timestamp <= VELOCITY_WINDOW_MS);
		const recentSentiment = this.messages.filter((message) => now - message.timestamp <= SENTIMENT_WINDOW_MS);
		const counts = sentimentCounts(recentSentiment);
		return {
			messageCount: this.messages.length,
			chatVelocity: recentVelocity.length,
			sentiment: {
				...counts,
				label: dominantSentiment(counts),
			},
			questions: this.questions.slice(),
			flags: this.flags.slice(),
			lastUpdated: this.lastUpdated,
		};
	}

	findQuestion(id: string): AudienceQuestion | null {
		return this.questions.find((question) => question.id === id) ?? null;
	}

	findFlag(id: string): AudienceFlag | null {
		return this.flags.find((flag) => flag.id === id) ?? null;
	}

	clear(): void {
		this.messages = [];
		this.questions = [];
		this.flags = [];
		this.lastUpdated = 0;
		this.emit();
	}

	subscribe(listener: AudienceListener): () => void {
		this.listeners.push(listener);
		listener(this.snapshot());
		return () => {
			this.listeners = this.listeners.filter((entry) => entry !== listener);
		};
	}

	private addQuestion(question: AudienceQuestion): void {
		const key = questionKey(question);
		if (this.questions.some((entry) => questionKey(entry) === key)) return;
		this.questions = [question, ...this.questions].slice(0, MAX_QUESTIONS);
	}

	private addFlag(flag: AudienceFlag): void {
		const key = flagKey(flag);
		if (this.flags.some((entry) => flagKey(entry) === key)) return;
		this.flags = [flag, ...this.flags].slice(0, MAX_FLAGS);
	}

	private emit(): void {
		const snapshot = this.snapshot();
		for (const listener of this.listeners) listener(snapshot);
	}
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function finiteTimestamp(timestamp: number): number {
	return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function sentimentFor(normalized: string): AudienceSentiment {
	const positive = POSITIVE_TERMS.some((term) => hasTerm(normalized, term));
	const negative = NEGATIVE_TERMS.some((term) => hasTerm(normalized, term));
	if (positive && !negative) return "positive";
	if (negative && !positive) return "negative";
	return "neutral";
}

function hasTerm(text: string, term: string): boolean {
	if (term.includes(" ")) return text.includes(term);
	return new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(text);
}

function questionFor(message: AudienceMessage): AudienceQuestion | null {
	const firstWord = message.normalized.split(/\s+/, 1)[0] ?? "";
	const asks = message.normalized.includes("?") || QUESTION_PREFIXES.includes(firstWord);
	if (!asks) return null;
	return {
		id: `q-${message.timestamp}-${hash(`${message.author}:${message.normalized}`)}`,
		author: message.author,
		text: message.text,
		timestamp: message.timestamp,
	};
}

function flagFor(message: AudienceMessage, messages: AudienceMessage[]): AudienceFlag | null {
	if (TOXIC_TERMS.some((term) => hasTerm(message.normalized, term))) {
		return flagged(message, "toxicity", "Harassment language", "high");
	}
	if (/(?:https?:\/\/|www\.)\S+/i.test(message.text)) {
		return flagged(message, "link", "External link", "medium");
	}
	if (isDuplicateSpam(message, messages) || /(.)\1{6,}/i.test(message.text)) {
		return flagged(message, "spam", "Repeated message pattern", "medium");
	}
	if (isMostlyCaps(message.text)) {
		return flagged(message, "caps", "Mostly caps", "low");
	}
	return null;
}

function flagged(
	message: AudienceMessage,
	kind: AudienceFlagKind,
	reason: string,
	severity: AudienceFlagSeverity,
): AudienceFlag {
	return {
		id: `flag-${message.timestamp}-${hash(`${kind}:${message.author}:${message.normalized}`)}`,
		author: message.author,
		text: message.text,
		timestamp: message.timestamp,
		kind,
		reason,
		severity,
	};
}

function isDuplicateSpam(message: AudienceMessage, messages: AudienceMessage[]): boolean {
	if (message.normalized.length < 6) return false;
	const recentMatches = messages.filter((entry) => {
		if (entry.author !== message.author) return false;
		if (entry.normalized !== message.normalized) return false;
		return message.timestamp - entry.timestamp <= DUPLICATE_WINDOW_MS;
	});
	return recentMatches.length >= 3;
}

function isMostlyCaps(text: string): boolean {
	const letters = text.replace(/[^A-Za-z]/g, "");
	if (letters.length < 10) return false;
	const caps = letters.replace(/[^A-Z]/g, "");
	return caps.length / letters.length >= 0.8;
}

function sentimentCounts(messages: AudienceMessage[]): Pick<AudienceSnapshot["sentiment"], "positive" | "neutral" | "negative"> {
	return messages.reduce(
		(counts, message) => ({
			...counts,
			[message.sentiment]: counts[message.sentiment] + 1,
		}),
		{ positive: 0, neutral: 0, negative: 0 },
	);
}

function dominantSentiment(counts: Pick<AudienceSnapshot["sentiment"], "positive" | "neutral" | "negative">): AudienceSentiment {
	if (counts.positive > counts.negative && counts.positive > 0) return "positive";
	if (counts.negative > counts.positive && counts.negative > 0) return "negative";
	return "neutral";
}

function questionKey(question: AudienceQuestion): string {
	return `${question.author.toLowerCase()}:${question.text.toLowerCase()}`;
}

function flagKey(flag: AudienceFlag): string {
	return `${flag.kind}:${flag.author.toLowerCase()}:${flag.text.toLowerCase()}`;
}

function hash(text: string): string {
	let value = 0;
	for (let index = 0; index < text.length; index += 1) {
		value = (value * 31 + text.charCodeAt(index)) | 0;
	}
	return Math.abs(value).toString(36);
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const audienceIntelligence = new AudienceIntelligence();
