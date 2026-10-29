import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BurnettBench Human Validation",
  description: "Human grader validation for BurnettBench Study 2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
