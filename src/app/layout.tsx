import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell";
import { LoginScreen } from "@/components/login";
import { RegisterServiceWorker } from "@/components/register-sw";
import { isSignedIn } from "@/lib/auth";
import { countOpenSignals } from "@/lib/proactive/engine";

export const metadata: Metadata = {
  title: { default: "Marketing HQ", template: "%s · Marketing HQ" },
  description: "One place for client work, marketing data, captured thinking and what needs to happen next.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Marketing HQ" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#101116" },
    { media: "(prefers-color-scheme: light)", color: "#f7f7f9" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Applies the saved theme before first paint so there is no flash of the wrong one.
const THEME_SCRIPT = `try{var t=localStorage.getItem("mhq-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const signedIn = await isSignedIn();
  const counts = signedIn ? await countOpenSignals().catch(() => ({ urgent: 0, important: 0, fyi: 0 })) : { urgent: 0, important: 0, fyi: 0 };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <RegisterServiceWorker />
        {signedIn ? <AppShell signalCount={counts.urgent + counts.important}>{children}</AppShell> : <LoginScreen />}
      </body>
    </html>
  );
}
