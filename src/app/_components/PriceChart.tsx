"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ResaleSnapshot } from "@/generated/prisma/client";
import { format } from "date-fns";
import { formatMoney } from "@/lib/format";

interface PriceChartProps {
  snapshots: ResaleSnapshot[];
}

export function PriceChart({ snapshots }: PriceChartProps) {
  if (snapshots.length === 0) {
    return null;
  }

  const data = snapshots
    .filter((s) => s.priceMedianUsd !== null)
    .map((s) => ({
      date: format(s.capturedAt, "MMM d"),
      median: s.priceMedianUsd,
      min: s.priceMinUsd,
      max: s.priceMaxUsd,
      avg: s.priceAvgUsd,
    }));

  if (data.length === 0) {
    return null;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          label={{ value: "Price (USD)", angle: -90, position: "insideLeft" }}
        />
        <Tooltip
          formatter={(value) => {
            if (typeof value === "number") {
              return formatMoney(value);
            }
            return "—";
          }}
          labelFormatter={(label) => `Date: ${label}`}
          contentStyle={{ backgroundColor: "#fff", border: "1px solid #ccc" }}
        />
        <Line
          type="monotone"
          dataKey="median"
          stroke="#2563eb"
          name="Median Price"
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
