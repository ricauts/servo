"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * The design system ships dark semantics at :root and light semantics under
 * `.servo-light`, so light mode applies that class (dark keeps Tailwind's
 * `.dark`, which removes it) — both modes then resolve through the ds's own
 * token blocks, and nothing re-declares colour values in the app.
 */
export default function ThemeProvider(
  props: ComponentProps<typeof NextThemesProvider>,
) {
  return (
    <NextThemesProvider
      {...props}
      value={{ light: "servo-light", dark: "dark", ...(props.value ?? {}) }}
    />
  );
}
