export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="加载中">
      <div className="card h-44 animate-pulse" />
      <div className="card h-24 animate-pulse" />
      <div className="card h-64 animate-pulse" />
    </div>
  );
}
