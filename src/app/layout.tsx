import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Money Planner · 旅行记账",
  description: "说一句话就记好账，AI 帮你盯住旅行预算。",
  applicationName: "Money Planner",
  // iOS 加到主屏后以全屏 App 形态打开
  appleWebApp: { capable: true, title: "记账", statusBarStyle: "default" },
  // 老版 iOS 仍读 apple-mobile-web-app-capable，Next 默认只输出 mobile-web-app-capable
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f6f5f2",
  width: "device-width",
  initialScale: 1,
  // 不设 maximumScale：禁止缩放会让看不清小字的用户无路可走（WCAG 1.4.4）
  // viewportFit=cover 才能拿到 iPhone 的安全区 inset
  viewportFit: "cover",
  // 键盘弹起时压缩可视区域，避免输入框被键盘盖住
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
