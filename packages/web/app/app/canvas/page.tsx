import { Suspense } from "react";

import { Canvas } from "@/components/canvas/canvas";

export const metadata = { title: "Canvas" };

export default function CanvasPage() {
  return (
    <div className="h-full w-full">
      <Suspense>
        <Canvas />
      </Suspense>
    </div>
  );
}
