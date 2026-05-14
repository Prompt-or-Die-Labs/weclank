import { audienceIntelligence } from "../../banter/audience-intelligence";
import { agentActionQueue } from "../../banter/action-queue";
import { Component } from "../../core/component";
import {
	generatePostStreamOutput,
	type PostStreamOutput,
} from "../../producer/content-engine";
import {
	generateStreamAnalytics,
	type StreamAnalytics,
} from "../../producer/stream-analytics";
import {
	generateShortFormPackage,
	type ShortFormPackage,
} from "../../producer/shortform";
import { studio } from "../../state/studio-store";
import { transcriptFeed } from "../../transcript/feed";
import { toast } from "../overlays";
import { escapeHtml } from "../primitives";

interface State {
	output: PostStreamOutput;
	analytics: StreamAnalytics;
	shortForm: ShortFormPackage;
}

export class OutputsTab extends Component<State> {
	private unsubAudience: (() => void) | null = null;
	private unsubActions: (() => void) | null = null;

	constructor() {
		super(generateState());
		studio.select(
			(s) => s.stream.title,
			() => this.setState(generateState()),
		);
		studio.select(
			(s) => s.runOfShow,
			() => this.setState(generateState()),
		);
	}

	protected rootClass(): string {
		return "tab tab-outputs";
	}

	protected template(): string {
		return `
			<div class="tab-outputs__head">
				<div>
					<h3>Post-stream outputs</h3>
					<p>Draft recap assets from the run-of-show, transcript feed, and audience intelligence.</p>
				</div>
				<div class="tab-outputs__actions">
					<button type="button" data-action="refresh">Refresh</button>
					<button type="button" data-action="copy">Copy report</button>
				</div>
			</div>
			${this.renderSection("Summary", this.state.output.summary)}
			${this.renderAnalytics()}
			${this.renderTopicEngagement()}
			${this.renderShortForm()}
			${this.renderChapters()}
			${this.renderClips()}
			${this.renderSection("Unanswered questions", this.state.output.unansweredQuestions)}
			${this.renderSection("Follow-up topics", this.state.output.followUpTopics)}
			${this.renderAiPerformance()}
			${this.renderSection("Sponsor report", this.state.output.sponsorReport)}
			${this.renderSection("Moderation report", this.state.output.moderationReport)}
			${this.renderNewsletter()}
			${this.renderSocialPosts()}
		`;
	}

	protected bind(): void {
		this.on(this.$('[data-action="refresh"]'), "click", () => {
			this.setState(generateState());
			toast("Outputs refreshed", "success");
		});
		this.on(this.$('[data-action="copy"]'), "click", () => void this.copyReport());
	}

	protected afterMount(): void {
		this.unsubAudience = audienceIntelligence.subscribe(() => this.setState(generateState()));
		this.unsubActions = agentActionQueue.subscribe(() => this.setState(generateState()));
	}

	protected beforeDestroy(): void {
		this.unsubAudience?.();
		this.unsubActions?.();
	}

	private renderSection(title: string, rows: string[]): string {
		return `
			<section class="tab-outputs__section">
				<div class="section-header">${escapeHtml(title)}</div>
				${rows.length === 0
					? '<div class="tab-outputs__empty">Nothing captured yet.</div>'
					: `<ul>${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>`}
			</section>
		`;
	}

	private renderChapters(): string {
		return `
			<section class="tab-outputs__section">
				<div class="section-header">Chapter markers</div>
				${this.state.output.chapters.length === 0
					? '<div class="tab-outputs__empty">No run segments yet.</div>'
					: `<div class="tab-outputs__chapters">
						${this.state.output.chapters.map((chapter) => `
							<div class="tab-outputs__chapter">
								<code>${escapeHtml(chapter.timecode)}</code>
								<span>${escapeHtml(chapter.title)}</span>
								<em>${escapeHtml(chapter.status)}</em>
							</div>
						`).join("")}
					</div>`}
			</section>
		`;
	}

	private renderAnalytics(): string {
		return `
			<section class="tab-outputs__section">
				<div class="section-header">Analytics</div>
				<div class="tab-outputs__metrics">
					${this.state.analytics.metrics.map((metric) => `
						<div class="tab-outputs__metric tab-outputs__metric--${metric.tone}">
							<span>${escapeHtml(metric.label)}</span>
							<strong>${escapeHtml(metric.value)}</strong>
							<em>${escapeHtml(metric.detail)}</em>
						</div>
					`).join("")}
				</div>
				<ul class="tab-outputs__recommendations">
					${this.state.analytics.recommendations.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
				</ul>
			</section>
		`;
	}

	private renderTopicEngagement(): string {
		return `
			<section class="tab-outputs__section">
				<div class="section-header">Topic engagement</div>
				${this.state.analytics.topics.length === 0
					? '<div class="tab-outputs__empty">No run segments yet.</div>'
					: `<div class="tab-outputs__topics">
						${this.state.analytics.topics.map((topic) => `
							<div class="tab-outputs__topic">
								<div>
									<strong>${escapeHtml(topic.title)}</strong>
									<span>${topic.questions} Q - ${topic.clips} clips - ${topic.transcriptMentions} mentions</span>
								</div>
								<em>${topic.score}</em>
							</div>
						`).join("")}
					</div>`}
			</section>
		`;
	}

	private renderClips(): string {
		return `
			<section class="tab-outputs__section">
				<div class="section-header">Clip candidates</div>
				${this.state.output.clipCandidates.length === 0
					? '<div class="tab-outputs__empty">No clip candidates yet.</div>'
					: `<div class="tab-outputs__clips">
						${this.state.output.clipCandidates.map((clip) => `
							<article class="tab-outputs__clip">
								<div>
									<strong>${escapeHtml(clip.title)}</strong>
									<span>${escapeHtml(clip.reason)}</span>
								</div>
								<em>${escapeHtml(clip.source)} - ${clip.score}</em>
							</article>
						`).join("")}
					</div>`}
			</section>
		`;
	}

	private renderShortForm(): string {
		return `
			<section class="tab-outputs__section">
				<div class="section-header">Short-form package</div>
				${this.state.shortForm.clips.length === 0
					? '<div class="tab-outputs__empty">No short-form plan yet.</div>'
					: `<div class="tab-outputs__shorts">
						${this.state.shortForm.clips.map((clip) => `
							<article class="tab-outputs__short">
								<div class="tab-outputs__short-head">
									<strong>${escapeHtml(clip.title)}</strong>
									<em>${clip.virality.total}</em>
								</div>
								<div class="tab-outputs__virality">
									<span>Hook ${clip.virality.hook}</span>
									<span>Eng ${clip.virality.engagement}</span>
									<span>Value ${clip.virality.value}</span>
									<span>Share ${clip.virality.shareability}</span>
								</div>
								<p>${escapeHtml(clip.virality.reason)}</p>
								<div class="tab-outputs__short-meta">
									<span>${escapeHtml(clip.preset)}</span>
									<span>${escapeHtml(clip.captionStyle)}</span>
									<span>B-roll: ${escapeHtml(clip.brollPrompts.slice(0, 2).join(" / "))}</span>
								</div>
							</article>
						`).join("")}
					</div>`}
				<ul class="tab-outputs__recommendations">
					${this.state.shortForm.productionNotes.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
				</ul>
			</section>
		`;
	}

	private renderNewsletter(): string {
		return `
			<section class="tab-outputs__section">
				<div class="section-header">Newsletter draft</div>
				<pre class="tab-outputs__draft">${escapeHtml(this.state.output.newsletter)}</pre>
			</section>
		`;
	}

	private renderAiPerformance(): string {
		const ai = this.state.analytics.aiContribution;
		return `
			<section class="tab-outputs__section">
				<div class="section-header">AI performance</div>
				<div class="tab-outputs__ai">
					<div><strong>${ai.score}</strong><span>Contribution score</span></div>
					<div><strong>${ai.executedActions}</strong><span>Executed actions</span></div>
					<div><strong>${ai.queuedActions}</strong><span>Pending actions</span></div>
					<div><strong>${ai.questionsDetected}</strong><span>Questions detected</span></div>
				</div>
			</section>
		`;
	}

	private renderSocialPosts(): string {
		return `
			<section class="tab-outputs__section">
				<div class="section-header">Social posts</div>
				<div class="tab-outputs__posts">
					${this.state.output.socialPosts.map((post) => `<p>${escapeHtml(post)}</p>`).join("")}
				</div>
			</section>
		`;
	}

	private async copyReport(): Promise<void> {
		try {
			await navigator.clipboard.writeText(reportText(this.state.output, this.state.analytics, this.state.shortForm));
			toast("Report copied", "success");
		} catch {
			toast("Couldn't copy report", "error");
		}
	}
}

function generateState(): State {
	const audience = audienceIntelligence.snapshot();
	const transcriptEvents = transcriptFeed.eventsSnapshot();
	const output = generatePostStreamOutput({
		streamTitle: studio.state.stream.title,
		runOfShow: studio.state.runOfShow,
		audience,
		transcriptEvents,
		now: Date.now(),
	});
	const analytics = generateStreamAnalytics({
		audience,
		runOfShow: studio.state.runOfShow,
		output,
		transcriptEvents,
		agentActions: agentActionQueue.all(),
		now: Date.now(),
	});
	const shortForm = generateShortFormPackage(output, analytics);
	return { output, analytics, shortForm };
}

function reportText(output: PostStreamOutput, analytics: StreamAnalytics, shortForm: ShortFormPackage): string {
	return [
		`# ${output.title}`,
		"",
		"## Summary",
		...output.summary.map((line) => `- ${line}`),
		"",
		"## Analytics",
		...analytics.metrics.map((metric) => `- ${metric.label}: ${metric.value} - ${metric.detail}`),
		"",
		"## Recommendations",
		...analytics.recommendations.map((line) => `- ${line}`),
		"",
		"## Topic Engagement",
		...analytics.topics.map((topic) => `- ${topic.title}: ${topic.score} (${topic.questions} Q, ${topic.clips} clips, ${topic.transcriptMentions} mentions)`),
		"",
		"## AI Performance",
		`- Contribution score: ${analytics.aiContribution.score}`,
		`- Executed actions: ${analytics.aiContribution.executedActions}`,
		`- Pending actions: ${analytics.aiContribution.queuedActions}`,
		`- Questions detected: ${analytics.aiContribution.questionsDetected}`,
		"",
		"## Chapters",
		...output.chapters.map((chapter) => `- ${chapter.timecode} ${chapter.title} (${chapter.status})`),
		"",
		"## Clip Candidates",
		...output.clipCandidates.map((clip) => `- ${clip.title} [${clip.source}, ${clip.score}] - ${clip.reason}`),
		"",
		"## Short-form Package",
		...shortForm.clips.map((clip) => `- ${clip.title}: ${clip.virality.total}/100, ${clip.preset}, ${clip.captionStyle}, B-roll: ${clip.brollPrompts.join(" / ")}`),
		...shortForm.productionNotes.map((line) => `- ${line}`),
		"",
		"## Unanswered Questions",
		...(output.unansweredQuestions.length ? output.unansweredQuestions.map((question) => `- ${question}`) : ["- None captured"]),
		"",
		"## Follow-up Topics",
		...output.followUpTopics.map((topic) => `- ${topic}`),
		"",
		"## Sponsor Report",
		...output.sponsorReport.map((line) => `- ${line}`),
		"",
		"## Moderation Report",
		...output.moderationReport.map((line) => `- ${line}`),
		"",
		"## Newsletter",
		output.newsletter,
		"",
		"## Social Posts",
		...output.socialPosts.map((post) => `- ${post}`),
	].join("\n");
}
