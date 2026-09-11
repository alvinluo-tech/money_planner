"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cx } from "@/lib/ui/format";

type SpeechCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  onInterim?: (text: string) => void;
  className?: string;
  size?: "sm" | "md" | "lg";
  title?: string;
}

export function VoiceInputButton({
  onTranscript,
  onInterim,
  className,
  size = "md",
  title = "按住或点击说出需求",
}: VoiceInputButtonProps) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const accumulatedRef = useRef("");

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const w = typeof window !== "undefined" ? (window as any) : null;
    const Ctor: SpeechCtor | undefined = w?.SpeechRecognition || w?.webkitSpeechRecognition;

    if (!Ctor) {
      toast.error("当前浏览器不支持原生语音识别，请在 Chrome、Edge 或 Safari 中使用语音");
      return;
    }

    try {
      accumulatedRef.current = "";
      const recognition = new Ctor();
      recognition.lang = "zh-CN";
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onresult = (event) => {
        let interim = "";
        let final = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if ((res as any).isFinal) {
            final += res[0].transcript;
          } else {
            interim += res[0].transcript;
          }
        }
        const text = final || interim;
        if (text) {
          accumulatedRef.current = text;
          onInterim?.(text);
        }
      };

      recognition.onerror = (e) => {
        if (e.error !== "no-speech") {
          console.warn("[VoiceInput] error:", e.error);
        }
        if (e.error === "not-allowed") {
          toast.error("请允许麦克风权限以使用语音输入");
        }
        stop();
      };

      recognition.onend = () => {
        const text = accumulatedRef.current.trim();
        if (text) {
          onTranscript(text);
        }
        setListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch (err) {
      console.error("[VoiceInput] start failed:", err);
      toast.error("启动麦克风失败，请重试");
      setListening(false);
    }
  }, [onTranscript, onInterim, stop]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (listening) {
      stop();
    } else {
      start();
    }
  };

  const sizeClasses = {
    sm: "h-7 w-7 text-xs",
    md: "h-9 w-9 text-sm",
    lg: "h-11 w-11 text-base",
  }[size];

  const iconSizes = {
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  }[size];

  return (
    <button
      type="button"
      onClick={handleClick}
      title={listening ? "点击停止聆听" : title}
      aria-label={listening ? "停止语音输入" : "开始语音输入"}
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center rounded-xl transition-all active:scale-95",
        listening
          ? "bg-rose-500 text-white shadow-md shadow-rose-200 animate-pulse ring-2 ring-rose-300"
          : "text-ink-muted hover:bg-paper hover:text-brand",
        sizeClasses,
        className,
      )}
    >
      {listening ? (
        <MicOff className={iconSizes} />
      ) : (
        <Mic className={iconSizes} />
      )}
      {listening && (
        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
        </span>
      )}
    </button>
  );
}
