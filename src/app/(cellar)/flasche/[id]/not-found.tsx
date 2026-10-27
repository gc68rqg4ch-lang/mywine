import Link from "next/link";

export default function NotFound() {
  return (
    <div className="stack">
      <h1 className="page-title">Flasche nicht gefunden</h1>
      <p className="muted">Diese Position existiert nicht oder du hast keinen Zugriff darauf.</p>
      <Link href="/" className="btn">
        Zum Bestand
      </Link>
    </div>
  );
}
