import { api } from "../../api/client";

type ModalApi = { confirm: (config: Record<string, unknown>) => unknown };
type Translate = (key: string, opts?: Record<string, unknown>) => string;
export type RestartMsg = { type: "success" | "error"; text: string };

// Shared "config written — restart Codex now?" confirmation, shown after a
// successful apply (the Targets-tab "写入文件并启用") so the new config takes
// effect without the user hunting for Codex to restart it.
export function promptRestartCodex(
  modal: ModalApi,
  t: Translate,
  onResult: (m: RestartMsg) => void
): void {
  modal.confirm({
    title: t("restart.restartConfirmTitle"),
    content: t("restart.restartConfirmBody"),
    okText: t("restart.restart"),
    cancelText: t("restart.restartLater"),
    okButtonProps: { danger: true },
    onOk: async () => {
      try {
        const r = await api.codexRestart();
        if (r.wasRunning) {
          onResult({ type: "success", text: t("restart.restarted", { killed: r.killed }) });
        } else if (r.relaunched) {
          onResult({ type: "success", text: t("restart.launched") });
        } else {
          onResult({ type: "error", text: t("restart.restartNoop") });
        }
      } catch (err) {
        const e = err as Error;
        const text = e.message.includes("unsupported_platform")
          ? t("restart.restartUnsupported")
          : e.message;
        onResult({ type: "error", text });
      }
    },
  });
}
