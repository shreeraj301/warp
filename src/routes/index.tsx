import { createFileRoute } from "@tanstack/react-router";
import { WarpApp } from "@/components/warp-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <WarpApp />;
}
