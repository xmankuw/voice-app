import "./globals.css";
import "@livekit/components-styles";

export const metadata = {
  title: "غرفة صوتية",
  description: "دردشة صوتية ومرئية بأقل تأخير ممكن",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
