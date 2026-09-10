"use client";

import { useEffect, useState } from "react";
import { Loader2, Settings2 } from "lucide-react";

export function ModelSelector() {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentModel, setCurrentModel] = useState<string>("");

  const fetchModels = async () => {
    if (models.length > 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/models");
      const data = await res.json();
      if (data.ok && data.models) {
        setModels(data.models);
      }
    } catch (e) {
      console.error("Failed to fetch models", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Read the current model from cookie
    const match = document.cookie.match(/(?:^|; )ai-model-preference=([^;]*)/);
    if (match) {
      setCurrentModel(decodeURIComponent(match[1]));
    }
    fetchModels();
  }, []);

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setCurrentModel(val);
    if (!val) {
      document.cookie = "ai-model-preference=; path=/; max-age=0; SameSite=Lax";
    } else {
      document.cookie = `ai-model-preference=${encodeURIComponent(val)}; path=/; max-age=31536000; SameSite=Lax`; // 1 year
    }
    // Reload page to apply changes across the app immediately
    window.location.reload();
  };

  return (
    <div className="flex items-center space-x-2 text-sm text-gray-500">
      <Settings2 className="w-4 h-4" />
      <span className="hidden sm:inline">AI 模型:</span>
      <select
        value={currentModel}
        onClick={fetchModels}
        onFocus={fetchModels}
        onChange={handleSelect}
        className="bg-transparent border-b border-gray-300 dark:border-gray-700 outline-none text-gray-700 dark:text-gray-300 cursor-pointer max-w-[120px] sm:max-w-none truncate"
        title="选择 AI 模型"
      >
        <option value="">默认配置</option>
        {currentModel && !models.includes(currentModel) && (
          <option value={currentModel}>{currentModel}</option>
        )}
        {loading && models.length === 0 && <option disabled>加载中...</option>}
        {models.map(m => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  );
}
