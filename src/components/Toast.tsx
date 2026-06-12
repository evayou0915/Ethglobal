"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type Toast = { id: number; text: string; href?: string; tone?: "info" | "ok" | "err" };
type Ctx = { push: (t: Omit<Toast, "id">) => void };

const ToastCtx = createContext<Ctx | null>(null);

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("ToastProvider missing");
  return v;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { id, ...t }]);
    setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), 6000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div style={{ position: "fixed", bottom: 24, right: 24, display: "flex", flexDirection: "column", gap: 8, zIndex: 99999 }}>
        {items.map((t) => (
          <div
            key={t.id}
            style={{
              maxWidth: 380,
              padding: "12px 16px",
              background: t.tone === "err" ? "#7c2d12" : t.tone === "ok" ? "#0f766e" : "#2a1a10",
              color: "#faf3e3",
              borderRadius: 6,
              font: "13px/1.4 Inter, sans-serif",
              boxShadow: "0 12px 32px rgba(58,36,24,0.32)",
            }}
          >
            {t.text}
            {t.href && (
              <>
                {" "}
                <a href={t.href} target="_blank" rel="noopener noreferrer" style={{ color: "#fb923c", textDecoration: "underline" }}>
                  view ↗
                </a>
              </>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
