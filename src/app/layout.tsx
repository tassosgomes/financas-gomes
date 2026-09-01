import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Finanças Gomes",
  description: "Gestão financeira compartilhada",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
