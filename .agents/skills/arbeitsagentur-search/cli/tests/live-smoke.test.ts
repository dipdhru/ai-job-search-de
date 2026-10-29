import { expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

// Live: a handful of requests against the real API, so portal changes surface.
test("live search returns real postings and detail resolves one", async () => {
  const out = parseJSON<{ results: { id: string; title: string; url: string }[] }>(
    await runCLI(["search", "-q", "Softwareentwickler", "-l", "Berlin", "--per-page", "3"]),
  );
  expect(out.results.length).toBeGreaterThan(0);
  for (const job of out.results) {
    expect(job.id).toBeTruthy();
    expect(job.title).toBeTruthy();
    expect(job.url).toContain(job.id);
  }
  const detail = parseJSON<{ id: string; description: string | null }>(await runCLI(["detail", out.results[0].id]));
  expect(detail.id).toBe(out.results[0].id);
  expect(detail.description).toBeTruthy();
});
