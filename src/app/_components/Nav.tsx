import Link from "next/link";

export function Nav() {
  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-xl font-bold text-gray-900">
            Ticket Flip
          </Link>
          <div className="flex gap-6">
            <Link
              href="/"
              className="text-gray-700 hover:text-gray-900 font-medium"
            >
              Today's On-Sales
            </Link>
            <Link
              href="/history"
              className="text-gray-700 hover:text-gray-900 font-medium"
            >
              History
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
