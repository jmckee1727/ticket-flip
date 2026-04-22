import { prisma } from "@/lib/db";
import { HomepageTable } from "./_components/HomepageTable";

async function getUpcomingEvents() {
  // Only include on-sales from the start of today onward. Anything earlier
  // already happened and belongs on the history page, not the homepage.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const events = await prisma.event.findMany({
    where: {
      onsaleStart: {
        gte: startOfToday,
      },
      eventDate: {
        gte: new Date(),
      },
      hiddenFromHomepage: false,
    },
    include: {
      artist: true,
      venue: true,
      projections: {
        orderBy: { computedAt: "desc" },
        take: 1,
      },
    },
    orderBy: {
      onsaleStart: "asc", // soonest upcoming on-sale first
    },
  });

  return events;
}

export default async function Home() {
  const events = await getUpcomingEvents();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">
        Upcoming On-Sales
      </h1>
      <HomepageTable events={events} />
    </div>
  );
}
