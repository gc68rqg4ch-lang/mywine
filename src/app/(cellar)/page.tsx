import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StockValue } from "@/components/cellar/stock-value";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { AntoineNote } from "@/components/home/antoine-note";
import { getMemberSession } from "@/lib/auth";
import { DRINK_STATUS_LABELS, drinkStatusHref } from "@/lib/cellar/overview";
import { wineHref } from "@/lib/cellar/wine-page";
import { formatDate, formatMoney, wineTypeLabel } from "@/lib/format";
import { loadAvatar } from "@/lib/home/avatar";
import { noteContext } from "@/lib/home/compose";
import { generateDailyNote, PENDING_STALE_MS } from "@/lib/home/daily";
import { loadHomeData } from "@/lib/home/data";
import { currentTime, zurichParts } from "@/lib/home/dates";
import { fallbackNote } from "@/lib/home/fallback";
import { renderNote, wineLabel } from "@/lib/home/note";
import { legacyListTarget } from "@/lib/home/redirect";
import { drunkByType, openBottles, ratingSummary, readiness, recentPurchases, spending, stockTotals, stockUnits, unitKey } from "@/lib/home/summary";
import { later } from "@/lib/later";
import { getLocationFilter } from "@/lib/location";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Start" };

const fl = (n: number) => `${n} Fl.`;

export default async function HomePage({ searchParams }: PageProps<"/">) {
  // Alte Adressen des Bestands („/?q=…“) → „/bestand?…“.
  const target = legacyListTarget(await searchParams);
  if (target) redirect(target);

  const [{ supabase, person }, { filter, selected }] = await Promise.all([getMemberSession(), getLocationFilter()]);
  const now = currentTime();
  const p = zurichParts(now);
  const [data, avatar] = await Promise.all([loadHomeData(supabase, person?.id ?? null, now), loadAvatar(supabase)]);

  // Antoines Text: fertig aus der Tabelle; fehlt er (Cron ausgefallen), einmal im Hintergrund
  // nachholen und bis dahin den Ersatztext zeigen.
  const today = data.notes?.find((n) => n.note_date === p.date);
  const stalePending = today?.status === "pending" && now - Date.parse(today.created_at) >= PENDING_STALE_MS;
  if (person && data.notes && (!today || stalePending)) {
    later(async () => {
      try {
        await generateDailyNote(createAdminClient(), person);
      } catch (error) {
        console.error("daily note catch-up failed", error instanceof Error ? error.message : error);
      }
    });
  }
  const context = noteContext(data, person?.name ?? null, now);
  const note = today?.status === "done" && today.text ? { text: today.text, refs: today.wines } : fallbackNote(context.fallback);
  const inStock = new Set(context.fallback.units.map((u) => unitKey(u.wineId, u.year)));
  const { segments, errors } = renderNote(note.text, note.refs, inStock);
  if (errors.length) console.warn("daily note: wines", errors.join(", "));

  // Kacheln zum Bestand im gewählten Lagerort (wie die Bestand-Seite).
  const stock = filter ? data.stock.filter((s) => s.room === filter.room && (!filter.house || s.house === filter.house)) : data.stock;
  const totals = stockTotals(stock);
  const ready = readiness(stockUnits(stock, p.year));
  const open = openBottles(stock, p.date);
  const spent = spending(data.purchases, p.year);
  const recent = recentPurchases(data.purchases, 5);
  const drunk = drunkByType(data.drunk, now);
  const ratings = ratingSummary(data.ratings);
  const money = (chf: number) => formatMoney(chf, "CHF", { whole: true });

  return (
    <div className="stack-lg">
      <AntoineNote photo={avatar?.url ?? null} segments={segments} />

      {selected && <p className="muted small">Lagerort: {selected.label}</p>}

      <section className="tiles home-tiles" aria-label="Übersicht">
        <Link href="/bestand" className="tile tile-link">
          <h2 className="tile-title">Bestand</h2>
          <p className="tile-big">
            {totals.bottles} <span>Fl.</span>
          </p>
          <p className="tile-line">{totals.wines === 1 ? "1 Wein" : `${totals.wines} Weine`}</p>
          <StockValue paid={totals.paid} regular={totals.regular} />
        </Link>

        <Link href="/bestand" className="tile tile-link">
          <h2 className="tile-title">Ausgaben {p.year}</h2>
          <p className="tile-big tile-money">{money(spent.thisYear.chf)}</p>
          <p className="tile-line">{fl(spent.thisYear.bottles)} gekauft</p>
          {spent.thisYear.gifts > 0 && <p className="tile-line">🎁 {fl(spent.thisYear.gifts)} geschenkt</p>}
          <p className="tile-line muted">
            {p.year - 1}: {money(spent.lastYear.chf)} · {fl(spent.lastYear.bottles)}
            {spent.lastYear.gifts > 0 ? ` · 🎁 ${spent.lastYear.gifts}` : ""}
          </p>
        </Link>

        <div className="tile">
          <h2 className="tile-title">
            <Link href="/bestand" className="tile-title-link">
              Zuletzt eingebucht
            </Link>
          </h2>
          {recent.map((r, i) => (
            <Link key={`${r.at}-${i}`} href={wineHref(r.wineId!, r.year, { von: "start" })} className="tile-line tile-open">
              <span className="tile-open-name">{wineLabel(r.name ?? "Wein", r.year)}</span>
              <span className="muted">{formatDate(r.at.slice(0, 10))}</span>
            </Link>
          ))}
          {recent.length === 0 && <p className="tile-line muted">Noch keine Käufe</p>}
        </div>

        <Link href="/getrunken" className="tile tile-link">
          <h2 className="tile-title">Getrunken</h2>
          <DrunkLine label="Diesen Monat" count={drunk.month} />
          <DrunkLine label={`Jahr ${p.year}`} count={drunk.year} />
        </Link>

        <div className="tile">
          <h2 className="tile-title">Trinkreife</h2>
          <dl className="tile-dl">
            {(["overdue", "now"] as const).map((s) => (
              <div key={s} className={`drink drink-${s}`}>
                <dt>
                  <Link href={drinkStatusHref(s)} className="drink-link">
                    {DRINK_STATUS_LABELS[s]}
                  </Link>
                </dt>
                <dd>{fl(s === "overdue" ? ready.overdueBottles : ready.nowBottles)}</dd>
              </div>
            ))}
          </dl>
          {[...ready.overdue, ...ready.now].slice(0, 3).map((u) => (
            <Link key={unitKey(u.wineId, u.year)} href={wineHref(u.wineId, u.year, { von: "start" })} className="tile-line tile-open">
              <WineTypeIcon type={u.type} size={16} />
              <span className="tile-open-name">{wineLabel(u.name, u.year)}</span>
            </Link>
          ))}
        </div>

        <Link href="/offen" className="tile tile-link">
          <h2 className="tile-title">Offen</h2>
          <p className="tile-big">
            {open.length} <span>Fl.</span>
          </p>
          {open.slice(0, 4).map((o) => (
            <p key={o.itemId} className="tile-line tile-open">
              <WineTypeIcon type={o.type} size={16} />
              <span className="tile-open-name">{wineLabel(o.name, o.year)}</span>
              <span className="muted">{o.days == null ? "–" : `${o.days} T.`}</span>
            </p>
          ))}
          {open.length === 0 && <p className="tile-line muted">Keine offen</p>}
        </Link>

        <Link href="/verkostet" className="tile tile-link">
          <h2 className="tile-title">Verkostet</h2>
          <p className="tile-big">{data.tastedThisMonth}</p>
          <p className="tile-line">diesen Monat</p>
        </Link>

        {ratings && (
          <div className="tile">
            <h2 className="tile-title">Deine Bewertungen</h2>
            <p className="tile-big">
              {ratings.avg.toFixed(1)} <span>★ im Schnitt</span>
            </p>
            <p className="tile-line">{ratings.count === 1 ? "1 Wein bewertet" : `${ratings.count} Weine bewertet`}</p>
            <Link href={wineHref(ratings.best.wineId, ratings.best.year, { von: "start" })} className="tile-line tile-open">
              <span className="tile-open-name">Bester: {wineLabel(ratings.best.name, ratings.best.year)}</span>
              <span className="muted">{ratings.best.rating} ★</span>
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

function DrunkLine({ label, count }: { label: string; count: ReturnType<typeof drunkByType>["month"] }) {
  return (
    <div className="home-drunk">
      <p className="tile-line">
        <span className="muted">{label}:</span> <strong>{fl(count.total)}</strong>
      </p>
      {count.byType.length > 0 && (
        <p className="home-drunk-types">
          {count.byType.map((t) => (
            <span key={t.type} className="home-drunk-type" title={wineTypeLabel(t.type === "unknown" ? null : t.type)}>
              <WineTypeIcon type={t.type === "unknown" ? null : t.type} size={18} />
              {t.bottles}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
