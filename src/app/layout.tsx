import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/shell/Sidebar";
import CommandPalette from "@/components/shell/CommandPalette";
import ThemeProvider from "@/components/shell/ThemeProvider";
import { navForUser } from "@/components/shell/nav-items";
import { Toaster } from "@/components/ui/sonner";
import { getCurrentUserOrNull } from "@/lib/auth";

// Type is the design system's: Chivo + IBM Plex Mono, loaded by
// servo_design_system/tokens/fonts.css through globals.css. The previous
// identity's Lato / Merriweather / Roboto Mono next/font families are gone —
// nothing in src referenced their variables any more.

export const metadata: Metadata = {
  title: "Servo — the AI desk for the whole team",
  description:
    "The open-source AI desk for the whole team — agents, skills, knowledge and human approvals in one queue.",
};

// The whole app is a live database UI; never prerender.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The server layout computes the user's nav once; the palette renders
  // from the registry, never from a page list of its own (ux-01).
  const user = await getCurrentUserOrNull();
  const entries = user ? navForUser(user) : [];
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background font-sans text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
          <CommandPalette entries={entries} />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
