import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TourMap Editor",
  description: "GPX route editing studio for motorcycle touring.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
