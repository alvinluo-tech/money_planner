import type { MetadataRoute } from "next";

/** PWA 清单：加到手机主屏后可以全屏打开，看起来像个原生 App */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Money Planner · 旅行记账",
    short_name: "记账",
    description: "说一句话就记好账，AI 帮你盯住旅行预算。",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f5f2",
    theme_color: "#f6f5f2",
    lang: "zh-CN",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
