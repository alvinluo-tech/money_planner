"use client";

import { useState } from "react";
import { useSyncExternalStore } from "react";
import { Settings2 } from "lucide-react";

const noopSubscribe = () => () => {};

/** 从浏览器 cookie 读当前偏好的模型；服务端渲染给空值，水合后自动切到真实值 */
function useCurrentModel(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      const match = document.cookie.match(/(?:^|; )ai-model-preference=([^;]*)/);
      return match ? decodeURIComponent(match[1]) : "";
    },
    () => "",
  );
}

export function ModelSelector() {
  const currentModel = useCurrentModel();
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchModels = () => {
    if (models.length > 0 || loading) return;
    setLoading(true);
    fetch("/api/models")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.models)) setModels(data.models);
      })
      .catch((e) => console.error("Failed to fetch models", e))
      .finally(() => setLoading(false));
  };

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) {
      document.cookie = "ai-model-preference=; path=/; max-age=0; SameSite=Lax";
    } else {
      document.cookie = `ai-model-preference=${encodeURIComponent(val)}; path=/; max-age=31536000; SameSite=Lax`; // 1 year
    }
    // cookie 由服务端 aiConfig() 读取，刷新后全站生效
    window.location.reload();
  };

  return (
    <div className="flex items-center space-x-2 text-sm">
      <Settings2 className="h-4 w-4 text-ink-muted" />
      <span className="hidden text-ink-muted sm:inline">AI 模型:</span>
      <select
        value={currentModel}
        onClick={fetchModels}
        onFocus={fetchModels}
        onChange={handleSelect}
        className="cursor-pointer truncate border-b border-line bg-transparent text-ink-soft outline-none"
        title="选择 AI 模型"
      >
        <option value="">默认配置</option>
        {currentModel && !models.includes(currentModel) && (
          <option value={currentModel}>{currentModel}</option>
        )}
        {loading && models.length === 0 && <option disabled>加载中...</option>}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
