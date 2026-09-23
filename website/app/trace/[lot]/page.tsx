"use client";

import { useParams } from "next/navigation";
import TraceView from "../../components/trace-view";

export default function TraceLotPage() {
  const params = useParams<{ lot: string }>();
  const lot = typeof params?.lot === "string" ? decodeURIComponent(params.lot) : "";
  return <TraceView lot={lot} />;
}
