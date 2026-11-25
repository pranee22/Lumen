import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumen — 3D MRI Report Explainer",
  description:
    "An AI-enabled health literacy prototype that translates MRI reports into interactive 3D anatomical visuals and plain language.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-[#ECECE8] text-[#18181B] selection:bg-[#0F766E]/15 selection:text-[#115E59]">
        {children}
      </body>
    </html>
  );
}
