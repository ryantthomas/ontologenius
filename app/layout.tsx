import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ontologenius",
  description: "An ontology-governed knowledge graph you study by retrieval practice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="inner">
            <strong>
              <Link href="/" style={{ textDecoration: "none" }}>
                Ontologenius
              </Link>
            </strong>
            <span>ontology-governed study graphs</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
