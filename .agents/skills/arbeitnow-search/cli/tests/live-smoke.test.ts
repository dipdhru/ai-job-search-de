import { expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

// Live: one page scan against the real API, so format changes surface.
test("live search returns real postings with ids, titles and portal URLs", async () => {
  const out = parseJSON<{ results: { id: string; title: string; url: string }[] }>(
    await runCLI(["search", "--pages", "1", "--limit", "5"]),
  );
  expect(out.results.length).toBeGreaterThan(0);
  for (const job of out.results) {
    expect(job.id).toBeTruthy();
    expect(job.title).toBeTruthy();
    expect(job.url).toStartWith("https://www.arbeitnow.com/");
  }
});
