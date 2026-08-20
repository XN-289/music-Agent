import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { PlayerBar } from "@/components/player/player-bar";
import { Toaster } from "@/components/ui/sonner";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Music Agent · AI 音乐创作助手",
  description: "用一句话描述你的歌，AI 音乐制作人帮你写词、编曲、生成。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className={`${spaceGrotesk.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col pb-20">
        <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <span className="text-[11px]">♪</span>
              </span>
              Music Agent
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
