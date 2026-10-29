import { describe, test, expect } from "bun:test";
import { fixture, parseJSON, runCLI, runWithServer } from "./helpers";

const err = (stderr: string): { error?: string; code?: string } => {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
};

describe("arbeitsagentur CLI flag validation", () => {
  test("unknown flag exits 1 with UNKNOWN_FLAG", async () => {
    const r = await runCLI(["search", "-q", "Python", "--remote", "remote"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(err(r.stderr).code).toBe("UNKNOWN_FLAG");
  });

  for (const args of [["-q"], ["-q", ""], ["-l"]]) {
    test(`empty text flag ${JSON.stringify(args)} exits 1`, async () => {
      const r = await runCLI(["search", ...args]);
      expect(r.exitCode).toBe(1);
      expect(err(r.stderr).code).toBe("BAD_ARG");
    });
  }

  for (const [name, value] of [["jobage", "0.5"], ["jobage", "101"], ["per-page", "500"], ["page", "x"], ["limit", "0"]]) {
    test(`--${name} ${value} exits 1 with BAD_ARG`, async () => {
      const r = await runCLI(["search", "-q", "Python", `--${name}`, value]);
      expect(r.exitCode).toBe(1);
      expect(err(r.stderr).error).toContain(name);
    });
  }

  for (const name of ["work-hours", "contract", "offer-type"]) {
    test(`--${name} with an unknown value exits 1 instead of dropping the filter`, async () => {
      const r = await runCLI(["search", "-q", "Python", `--${name}`, "bogus"]);
      expect(r.exitCode).toBe(1);
      expect(err(r.stderr).code).toBe("BAD_ARG");
    });
  }

  test("--radius without --location exits 1", async () => {
    const r = await runCLI(["search", "-q", "Python", "--radius", "20"]);
    expect(r.exitCode).toBe(1);
  });

  for (const refnr of ["15240-k50661.2040-S", "12265-291249_JB5283384-S", "12462-1647919-1-S"]) {
    test(`detail accepts reference number ${refnr}`, async () => {
      const { requests } = await runWithServer(["detail", refnr], () => new Response("{}", { status: 404 }));
      expect(requests[0].url.pathname).toEndWith("/jobdetails/" + Buffer.from(refnr).toString("base64"));
    });
  }

  test("detail rejects a URL on another host", async () => {
    const r = await runCLI(["detail", "https://arbeitsagentur.de.evil.io/jobsuche/jobdetail/20390-978522636-S"]);
    expect(r.exitCode).toBe(1);
    expect(err(r.stderr).code).toBe("BAD_ID");
  });

  test("valid flags map to BA query parameters and the public client ID header", async () => {
    const body = await fixture("search.json");
    const { result, requests } = await runWithServer(
      ["search", "-q", "Data Scientist", "-l", "Berlin", "--radius", "25", "--jobage", "7",
       "--work-hours", "fulltime", "--contract", "permanent", "--per-page", "2"],
      () => Response.json(body),
    );
    const out = parseJSON<{ meta: { count: number; total: number }; results: Record<string, unknown>[] }>(result);
    expect(requests).toHaveLength(1);
    const p = requests[0].url.searchParams;
    expect(Object.fromEntries(p)).toEqual({
      was: "Data Scientist", wo: "Berlin", umkreis: "25", veroeffentlichtseit: "7",
      arbeitszeit: "vz", befristung: "2", angebotsart: "1", page: "1", size: "2",
    });
    expect(requests[0].headers.get("x-api-key")).toBe("jobboerse-jobsuche");
    expect(out.meta.count).toBe(2);
    for (const job of out.results) {
      for (const key of ["id", "title", "company", "location", "date", "url"]) expect(job).toHaveProperty(key);
      expect(String(job.url)).toStartWith("https://www.arbeitsagentur.de/jobsuche/jobdetail/");
    }
  });

  test("--offer-type all sends no angebotsart", async () => {
    const body = await fixture("search.json");
    const { requests } = await runWithServer(["search", "-q", "x", "--offer-type", "all"], () => Response.json(body));
    expect(requests[0].url.searchParams.has("angebotsart")).toBe(false);
  });

  test("detail base64-encodes the reference number and 404 maps to NOT_FOUND", async () => {
    const { result, requests } = await runWithServer(["detail", "https://www.arbeitsagentur.de/jobsuche/jobdetail/20390-978522636-S"],
      () => new Response("{}", { status: 404 }));
    expect(requests[0].url.pathname).toEndWith("/jobdetails/" + Buffer.from("20390-978522636-S").toString("base64"));
    expect(result.exitCode).toBe(1);
    expect(err(result.stderr).code).toBe("NOT_FOUND");
  });
});
