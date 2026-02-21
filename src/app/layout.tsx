import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'newcleus',
  description: 'A minimalist Hello World app.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
