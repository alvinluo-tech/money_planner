// 用 sharp 把矢量图标栅格化成 PWA / iOS 需要的 PNG（一次性脚本）
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const svg = await readFile("public/icon.svg");
const targets = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["public/apple-icon-180.png", 180],
];

for (const [out, size] of targets) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log("wrote", out, size + "px");
}
