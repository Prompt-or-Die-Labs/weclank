import { describe, expect, test } from "bun:test";
import { PRODUCT_PROMISE, PRODUCT_VERSION } from "./product";

interface PackageJson {
	version: string;
	description: string;
}

describe("product metadata", () => {
	test("keeps package metadata aligned with the app surface", async () => {
		const packageJson: PackageJson = JSON.parse(await Bun.file("package.json").text());
		expect(packageJson.version).toBe(PRODUCT_VERSION);
		expect(packageJson.description).toBe(PRODUCT_PROMISE);
	});
});
