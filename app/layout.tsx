import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BIZ_UDPMincho } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// フォントの設定 (サブセットに 'latin'、変数を '--font-noto-serif' に指定)
const bizUdpMincho = BIZ_UDPMincho({
  variable: "--font-bizUdpMincho",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "DoubleApple",
  description: "Created by Antigravity IDE",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} ${bizUdpMincho.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
