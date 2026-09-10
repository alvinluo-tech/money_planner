"use client";

/** 根布局自身出错时才会用到，必须自己渲染 html/body */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
          background: "#f6f5f2",
          color: "#1c1917",
        }}
      >
        <h1 style={{ fontSize: 18, margin: 0 }}>页面出错了</h1>
        <p style={{ fontSize: 13, color: "#57534e", margin: 0 }}>{error.message}</p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 8,
            padding: "10px 20px",
            borderRadius: 12,
            border: "none",
            background: "#1c1917",
            color: "#fff",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          重试
        </button>
      </body>
    </html>
  );
}
