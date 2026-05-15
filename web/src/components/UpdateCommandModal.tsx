import { useState } from "react";
import { Alert, Button, Modal, Tag } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAppConfig } from "../contexts/AppConfigContext";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Read-only modal that surfaces the exact update command for the user's
// install method, with one-click copy. Always available regardless of
// whether "update now" succeeded — users may prefer running it themselves.
export function UpdateCommandModal({ open, onClose }: Props) {
  const { t } = useTranslation("update");
  const { versionInfo } = useAppConfig();
  const [copied, setCopied] = useState(false);

  if (!versionInfo) return null;

  const method = versionInfo.method;
  const command = versionInfo.command;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Some browsers / non-secure contexts refuse clipboard access — user
      // can still select & copy from the rendered <code> block manually.
    }
  };

  return (
    <Modal
      open={open}
      title={t("command.title")}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          {t("command.close")}
        </Button>,
      ]}
      destroyOnClose
    >
      <div style={{ marginBottom: 12 }}>
        {t("command.detected", { method: "" })}
        <Tag color={method === "unknown" ? "warning" : "blue"} style={{ marginLeft: 8 }}>
          {t(`method.${method}`)}
        </Tag>
      </div>
      <pre
        style={{
          background: "rgba(0,0,0,0.06)",
          padding: 12,
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: 12,
          margin: 0,
          borderRadius: 4,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {command}
      </pre>
      <Button
        icon={<CopyOutlined />}
        onClick={copy}
        style={{ marginTop: 12 }}
        type={copied ? "primary" : "default"}
      >
        {copied ? t("command.copied") : t("command.copy")}
      </Button>
      {method === "unknown" && (
        <Alert
          style={{ marginTop: 12 }}
          type="warning"
          showIcon
          message={t("modal.skipped")}
        />
      )}
    </Modal>
  );
}
