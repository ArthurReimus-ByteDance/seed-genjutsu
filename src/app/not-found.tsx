import Link from "next/link";
export default function NotFound() {
  return (
    <main className="boot">
      <h1>This frame is missing.</h1>
      <Link href="/">Back to the studio</Link>
    </main>
  );
}
