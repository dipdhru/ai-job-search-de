# arbeitsagentur-cli

Zero-dependency Bun CLI for the Bundesagentur für Arbeit Jobsuche API, Germany's official job board.
See `../SKILL.md` for usage and `../url-reference.md` for the endpoints.

```bash
bun run src/cli.ts search -q "Data Scientist" -l Berlin --format table
bun run src/cli.ts detail <refnr> --format plain
bun install && bun run typecheck && bun run test   # dev types + tests (one live smoke test)
```
