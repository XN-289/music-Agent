import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { PlayerBar } from "@/components/player/player-bar";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Music Agent · AI 音乐创作助手",
  description: "用一句话描述你的歌，AI 音乐制作人帮你写词、编曲、生成。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col pb-20">
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="text-lg">🎧</span> Music Agent
            </Link>
            <nav className="flex items-center gap-1 text-sm text-muted-foreground">
              <Link href="/" className="rounded-md px-3 py-1.5 transition-colors hover:bg-accent hover:text-foreground">
                创作
              </Link>
              <Link href="/library" className="rounded-md px-3 py-1.5 transition-colors hover:bg-accent hover:text-foreground">
                曲库
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <PlayerBar />
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
