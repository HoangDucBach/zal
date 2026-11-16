import { useEffect, useState, type RefObject } from "react";

export interface ElementSize {
  readonly width: number;
  readonly height: number;
}

/** The element's content box, kept current with a ResizeObserver. Zero until it has been measured. */
export function useElementSize(
  ref: RefObject<HTMLElement | null>,
): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;

    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;

      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return size;
}
