import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="shell not-found-page rise">
      <p className="pill">404 · Matter not found</p>
      <h1 className="brand">This room is elsewhere.</h1>
      <p className="lede">
        The link may be incomplete, expired, or the matter may not exist anymore.
      </p>
      <div className="row not-found-actions">
        <Link href="/" className="btn">Back to Settle</Link>
        <Link href="/?start=true" className="btn ghost">Start a matter</Link>
      </div>
    </main>
  );
}
