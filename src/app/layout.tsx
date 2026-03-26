import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bestparts — Memorable Movie Scenes",
  description:
    "A community collection of the most memorable scenes from movies.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 min-h-screen antialiased">
        <header className="border-b border-neutral-800">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2 group">
              <span className="text-2xl font-black tracking-tight text-white group-hover:text-yellow-400 transition-colors">
                best<span className="text-yellow-400 group-hover:text-white transition-colors">parts</span>.biz
              </span>
            </a>
            <a
              href="/submit"
              className="bg-yellow-400 hover:bg-yellow-300 text-neutral-950 font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              + Submit a scene
            </a>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
        <footer className="border-t border-neutral-800 mt-16">
          <div className="max-w-6xl mx-auto px-4 py-6 text-center text-neutral-600 text-sm">
            bestparts.biz | mark griffioen
          </div>
        </footer>
      </body>
    </html>
  );
}
