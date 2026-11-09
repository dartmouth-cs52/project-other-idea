import type { Metadata } from "next";
import { EB_Garamond, Figtree } from "next/font/google";
import "./globals.css";

const display = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-garamond",
});

const body = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-figtree",
});

export const metadata: Metadata = {
  title: { default: "Haptic: show your users where to click", template: "%s · Haptic" },
  description: "Haptic is an AI guide for web apps. Your users ask how to do something, and a pointer walks them there one click at a time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full ${display.variable} ${body.variable}`}>
      <body className="min-h-full text-[14px] leading-relaxed">{children}</body>
    </html>
  );
}
