import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      <p className="text-sm font-medium text-slate-500">404</p>
      <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
      <Link href="/" className="text-sm font-medium text-slate-900 underline">
        Go back home
      </Link>
    </div>
  );
}
