import { describe, expect, test } from "bun:test";
import type { PostStreamOutput } from "./content-engine";
import type { StreamAnalytics } from "./stream-analytics";
import { generateShortFormPackage } from "./shortform";

describe("shortform package", () => {
	test("turns post-stream clip candidates into short-form production plans", () => {
		const output: PostStreamOutput = {
			generatedAt: 1,
			title: "Launch stream",
			summary: ["A demo landed."],
			chapters: [],
			clipCandidates: [
				{ title: "Viewer asks: Can you demo the overlay again?", source: "audience", reason: "Viewer question can become a Q&A short.", score: 70 },
				{ title: "Bash bun test passed", source: "transcript", reason: "Tool activity can anchor a process clip.", score: 68 },
			],
			unansweredQuestions: ["Mina: Can you demo the overlay again?"],
			followUpTopics: [],
			newsletter: "",
			socialPosts: [],
			sponsorReport: [],
			moderationReport: [],
		};
		const analytics: StreamAnalytics = {
			generatedAt: 1,
			metrics: [],
			topics: [{ segmentId: "demo", title: "Product demo", status: "done", score: 80, questions: 1, clips: 1, transcriptMentions: 2 }],
			aiContribution: { score: 60, queuedActions: 0, executedActions: 1, rejectedActions: 0, questionsDetected: 1, moderationFlags: 0, transcriptEvents: 2 },
			recommendations: [],
		};

		const pkg = generateShortFormPackage(output, analytics);

		expect(pkg.exportPresets.map((preset) => preset.id)).toEqual(["tiktok", "reels", "shorts"]);
		expect(pkg.clips[0]!.preset).toBe("reels");
		expect(pkg.clips[0]!.captionStyle).toBe("podcast");
		expect(pkg.clips[0]!.virality.total).toBeGreaterThan(0);
		expect(pkg.productionNotes[0]).toContain("Viewer asks");
	});
});
