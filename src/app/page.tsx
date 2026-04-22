import { prisma } from "@/lib/db";
import { HomepageTable } from "./_components/HomepageTable";

async function getUpcomingEvents() {
  const now = new Date();
  const events = await prisma.event.findMany({
    where: {
      // Filter out TBA placeholders and nulls
      onsaleStart: {
        gte: new Date("2020-01-01"),
      },
      eventDate: {
        gte: now,
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
      onsaleStart: "asc",
    },
  });

  return events;
}

export default async function Home() {
  const events = await getUpcomingEvents();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">
        Today's On-Sales
      </h1>
      <HomepageTable events={events} />
    </div>
  );
}
