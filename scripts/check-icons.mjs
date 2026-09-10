import sharp from "sharp";
for (const f of ["public/icon-512.png", "public/apple-icon-180.png"]) {
  const img = sharp(f);
  const meta = await img.metadata();
  const stats = await img.stats();
  console.log(f, meta.width + "x" + meta.height, "channels:", meta.channels,
    "means:", stats.channels.map((c) => Math.round(c.mean)).join(","));
}
