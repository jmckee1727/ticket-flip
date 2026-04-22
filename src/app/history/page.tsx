import { Suspense } from "react";
import { HistoryBrowser } from "@/app/_components/HistoryBrowser";

export default function HistoryPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Event History</h1>
      <Suspense
        fallback={
          <div className="text-center py-8 text-gray-600">Loading...</div>
        }
      >
        <HistoryBrowser />
      </Suspense>
    </div>
  );
}
