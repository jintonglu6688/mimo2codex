import { useEffect, useRef, useState } from "react";
import { Button, Space, Checkbox } from "antd";

interface Line { ts: number; text: string; channel: "stdout" | "stderr" }
const MAX_LINES = 1000;

export function App() {
  const [lines, setLines] = useState<Line[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = window.m2c.on((msg) => {
      if (msg.type === "logs:line") {
        setLines((prev) => {
          const next = [...prev, { ts: Date.now(), text: msg.payload.line, channel: msg.payload.channel }];
          if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
          return next;
        });
      }
    });
    window.m2c.send({ type: "logs:subscribe" });
    return off;
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [lines, autoScroll]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", padding: 8, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
      <div style={{ flex: 1, overflow: "auto", background: "#1e1e1e", color: "#ddd", padding: 8, borderRadius: 4 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: l.channel === "stderr" ? "#ff8888" : "#ddd", whiteSpace: "pre-wrap" }}>
            {l.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ marginTop: 8 }}>
        <Space>
          <Button size="small" onClick={() => setLines([])}>Clear</Button>
          <Checkbox checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)}>Auto-scroll</Checkbox>
        </Space>
      </div>
    </div>
  );
}
