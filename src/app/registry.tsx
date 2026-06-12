"use client";

import { useState } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { StyleRegistry, createStyleRegistry } from "styled-jsx";

/** Collects styled-jsx styles during SSR and flushes them into the HTML head
 *  before the browser paints. Without this wrapper, Next 14 App Router
 *  renders the markup but ships its <style jsx> styles only after JS
 *  hydration — causing a flash of un-styled modals/cards on hard refresh.
 *  Following the recipe from
 *  https://nextjs.org/docs/app/building-your-application/styling/css-in-js#styled-jsx */
export default function StyledJsxRegistry({ children }: { children: React.ReactNode }) {
  const [registry] = useState(() => createStyleRegistry());

  useServerInsertedHTML(() => {
    const styles = registry.styles();
    registry.flush();
    return <>{styles}</>;
  });

  return <StyleRegistry registry={registry}>{children}</StyleRegistry>;
}
