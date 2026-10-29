import { describe, test, expect } from "bun:test";
import { fixture, parseJSON, runCLI, runWithServer } from "./helpers";

type Page = { data: Record<string, unknown>[]; links: Record<string, unknown> };
type Out = { meta: { count: number; pagesScanned: number }; results: { id: string; remote: boolean }[] };

const err = (stderr: string): { error?: string; code?: string } => {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
};

/** The fixture page with fresh timestamps, so --jobage tests do not age. */
async function freshPage(): Promise<Page> {
  const page = (await fixture("page.json")) as Page;
  const now = Math.floor(Date.now() / 1000);
  page.data.forEach((item, i) => (item.created_at = now - i * 3600));
  return page;
}

describe("arbeitnow CLI flag validation", () => {
  test("unknown flag exits 1 with UNKNOWN_FLAG", async () => {
    const r = await runCLI(["search", "-q", "python", "--contract", "permanent"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(err(r.stderr).code).toBe("UNKNOWN_FLAG");
  });

  for (const [name, value] of [["pages", "11"], ["jobage", "0"], ["page", "1.5"], ["remote", "yes"], ["match", "body"]]) {
    test(`--${name} ${value} exits 1 with BAD_ARG`, async () => {
      const r = await runCLI(["search", `--${name}`, value]);
      expect(r.exitCode).toBe(1);
      expect(err(r.stderr).code).toBe("BAD_ARG");
    });
  }

  test("empty --query exits 1", async () => {
    expect((await runCLI(["search", "-q", ""])).exitCode).toBe(1);
  });

  test("detail rejects a URL on another host", async () => {
    const r = await runCLI(["detail", "https://arbeitnow.com.evil.io/jobs/companies/x/some-job-123"]);
    expect(err(r.stderr).code).toBe("BAD_ID");
  });

  test("filters run client-side over the scanned pages and stop at the last page", async () => {
    const page = await freshPage();
    const { result, requests } = await runWithServer(["search", "--remote", "only", "--pages", "5"], () => Response.json(page));
    const out = parseJSON<Out>(result);
    expect(requests).toHaveLength(1); // links.next is null in the fixture
    expect(requests[0].url.searchParams.get("page")).toBe("1");
    expect(out.results.map((r) => r.id)).toEqual(["homeoffice-kundensupport-in-vollzeit-monheim-am-rhein-304608"]);
  });

  test("a posting repeated across scanned pages is emitted once", async () => {
    const page = await freshPage();
    page.links.next = "https://www.arbeitnow.com/api/job-board-api?page=2";
    const { result, requests } = await runWithServer(["search", "--pages", "2"], () => Response.json(page));
    expect(requests).toHaveLength(2);
    expect(parseJSON<Out>(result).meta.count).toBe(page.data.length);
  });

  test("location folds umlauts and the Munich alias", async () => {
    const page = await freshPage();
    const { result } = await runWithServer(["search", "-l", "Munich"], () => Response.json(page));
    expect(parseJSON<Out>(result).results.map((r) => r.id)).toEqual([String(page.data[2].slug)]);
  });

  test("--jobage drops older postings", async () => {
    const page = await freshPage();
    page.data[2].created_at = Math.floor(Date.now() / 1000) - 5 * 86400;
    const { result } = await runWithServer(["search", "--jobage", "2"], () => Response.json(page));
    expect(parseJSON<Out>(result).meta.count).toBe(2);
  });

  test("results carry the shared portal fields", async () => {
    const page = await freshPage();
    const { result } = await runWithServer(["search", "-q", "operations"], () => Response.json(page));
    const out = parseJSON<{ results: Record<string, unknown>[] }>(result);
    expect(out.results).toHaveLength(1);
    for (const key of ["id", "title", "company", "location", "date", "url"]) expect(out.results[0]).toHaveProperty(key);
    expect(String(out.results[0].url)).toStartWith("https://www.arbeitnow.com/");
  });

  test("detail finds a posting by URL and misses come back NOT_FOUND", async () => {
    const page = await freshPage();
    const slug = String(page.data[0].slug);
    const hit = await runWithServer(["detail", `https://www.arbeitnow.com/jobs/companies/enpal/${slug}`], () => Response.json(page));
    expect(parseJSON<{ id: string; description: string }>(hit.result).id).toBe(slug);
    const miss = await runWithServer(["detail", "no-such-posting-1"], () => Response.json(page));
    expect(err(miss.result.stderr).code).toBe("NOT_FOUND");
  });
});
