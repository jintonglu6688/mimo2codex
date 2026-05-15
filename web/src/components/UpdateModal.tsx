import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal } from "antd";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAppConfig } from "../contexts/AppConfigContext";

interface LineEntry {
  line: string;
  stream: "stdout" | "stderr";
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Phase = "idle" | "running" | "ok" | "fail" | "error" | "skipped";

// Modal that opens a fetch-based stream against POST /admin/api/update and
// renders each SSE `line` event as it arrives. EventSource doesn't support
// POST, so we use fetch + manual line splitting on the response body reader.
export function UpdateModal({ open, onClose }: Props) {
  const { t } = useTranslation("update");
  const { versionInfo } = useAppConfig();
  const [lines, setLines] = useState<LineEntry[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);

  // Kick off the SSE stream the first time the modal opens. Re-opening after
  // a completed run lets the user retry — we reset state and re-stream.
  useEffect(() => {
    if (!open) return;
    setLines([]);
    setPhase("running");
    setExitCode(null);
    setErrorMsg(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    void runStream(ctl.signal, (entry) => {
      if (entry.type === "line") {
        setLines((prev) => [...prev, { line: entry.line, stream: entry.stream }]);
      } else if (entry.type === "done") {
        setExitCode(entry.exitCode);
        if (entry.skipped) setPhase("skipped");
        else setPhase(entry.exitCode === 0 ? "ok" : "fail");
      } else if (entry.type === "error") {
        setErrorMsg(entry.message);
        setPhase("error");
      }
    });
    return () => {
      ctl.abort();
    };
  }, [open]);

  // Auto-scroll the log view as new lines arrive — typical "tail -f" feel.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  const method = versionInfo?.method ?? "unknown";
  const methodLabel = t(`method.${method}`);

  return (
    <Modal
      open={open}
      title={t("modal.title")}
      onCancel={onClose}
      width={760}
      footer={[
        <Button key="close" onClick={onClose} disabled={phase === "running"}>
          {t("modal.close")}
        </Button>,
      ]}
      destroyOnClose
    >
      <div style={{ marginBottom: 12, opacity: 0.75 }}>
        {t("modal.subtitle", { method: methodLabel })}
      </div>
      <pre
        ref={logRef}
        style={{
          background: "rgba(0,0,0,0.06)",
          padding: 12,
          height: 360,
          overflow: "auto",
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: 12,
          lineHeight: 1.5,
          margin: 0,
          borderRadius: 4,
        }}
      >
        {lines.length === 0 && phase === "running" && t("modal.running")}
        {lines.map((l, i) => (
          <div key={i} style={{ color: l.stream === "stderr" ? "#c62828" : undefined }}>
            {l.line}
          </div>
        ))}
      </pre>
      <PhaseAlert phase={phase} exitCode={exitCode} errorMsg={errorMsg} />
    </Modal>
  );
}

function PhaseAlert({
  phase,
  exitCode,
  errorMsg,
}: {
  phase: Phase;
  exitCode: number | null;
  errorMsg: string | null;
}) {
  const { t } = useTranslation("update");
  if (phase === "running" || phase === "idle") return null;
  if (phase === "ok") {
    return <Alert style={{ marginTop: 12 }} type="success" showIcon message={t("modal.doneOk")} />;
  }
  if (phase === "fail") {
    return (
      <Alert
        style={{ marginTop: 12 }}
        type="error"
        showIcon
        message={t("modal.doneFail", { exitCode: exitCode ?? "?" })}
      />
    );
  }
  if (phase === "skipped") {
    return (
      <Alert
        style={{ marginTop: 12 }}
        type="warning"
        showIcon
        message={t("modal.skipped")}
      />
    );
  }
  return (
    <Alert
      style={{ marginTop: 12 }}
      type="error"
      showIcon
      message={t("modal.errored", { message: errorMsg ?? "unknown" })}
    />
  );
}

// SSE parser over a POST stream. The shared `api.*` helpers are JSON-only;
// rolling this here keeps the wrapper untouched and avoids a dependency.
type StreamEntry =
  | { type: "line"; line: string; stream: "stdout" | "stderr" }
  | { type: "done"; exitCode: number; method: string; skipped: boolean }
  | { type: "error"; message: string };

async function runStream(signal: AbortSignal, onEntry: (e: StreamEntry) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch(api.updateStreamUrl(), {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      signal,
    });
  } catch (err) {
    onEntry({ type: "error", message: (err as Error).message });
    return;
  }
  if (!res.ok || !res.body) {
    onEntry({ type: "error", message: `HTTP ${res.status}` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line. Each frame may have multiple
      // header-style lines; we only consume `event:` and `data:` here.
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const headers = frame.split(/\r?\n/);
        let evtName = "message";
        let dataJson = "";
        for (const h of headers) {
          if (h.startsWith("event:")) evtName = h.slice(6).trim();
          else if (h.startsWith("data:")) dataJson += h.slice(5).trim();
        }
        if (!dataJson) continue;
        try {
          const parsed = JSON.parse(dataJson);
          if (evtName === "line") {
            onEntry({ type: "line", line: parsed.line, stream: parsed.stream });
          } else if (evtName === "done") {
            onEntry({
              type: "done",
              exitCode: parsed.exitCode,
              method: parsed.method,
              skipped: parsed.skipped,
            });
          } else if (evtName === "error") {
            onEntry({ type: "error", message: parsed.message });
          }
        } catch {
          // malformed frame — ignore
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      onEntry({ type: "error", message: (err as Error).message });
    }
  }
}

