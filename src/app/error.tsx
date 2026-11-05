"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="boot">
      <h1>The studio hit a snag.</h1>
      <p>Your saved generations are safe. Try opening the workspace again.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
