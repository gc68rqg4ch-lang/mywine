<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Regeln für dieses Projekt

- **Keine Test-User oder Testdaten in der Produktions-DB anlegen** (Supabase-Projekt `ckwwttimhhogyzekvlad`). Den eingeloggten Teil testet der Owner selbst; Agenten prüfen Build, Lint, nicht eingeloggte Abläufe und lesende SQL-Abfragen.
- **Schemaänderungen nur als Migrationsdatei** unter `supabase/migrations/` ins Repo legen – nicht selbst einspielen. Eingespielt werden sie vom Owner bzw. über Claude im Chat.
- Nach Schemaänderungen `src/lib/database.types.ts` aus dem aktuellen Schema neu generieren.
