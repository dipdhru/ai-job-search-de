# arbeitnow-cli

Zero-dependency Bun CLI for Arbeitnow's free public job-board API, covering jobs in Germany and Europe.
See `../SKILL.md` for usage and `../url-reference.md` for the endpoint.

```bash
bun run src/cli.ts search -q python -l Berlin --match all --format table
bun install && bun run typecheck && bun run test   # dev types + tests (one live smoke test)
```
