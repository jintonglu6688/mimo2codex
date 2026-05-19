import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  api,
  type CodexHistoryRow,
  type CodexBundleResponse,
} from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";

const KIND_COLOR: Record<CodexHistoryRow["kind"], string> = {
  initial: "purple",
  apply: "blue",
  restore: "orange",
};

function downloadString(content: string, filename: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function HistoryPanel(): JSX.Element {
  const { t } = useTranslation("auth");
  const { authMode } = useAuth();
  const [rows, setRows] = useState<CodexHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, msgCtx] = message.useMessage();

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.codexHistory();
      setRows(r.history);
    } catch (err) {
      if ((err as Error).message?.includes("401")) return;
      msg.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onDownload(row: CodexHistoryRow) {
    try {
      const b: CodexBundleResponse = await api.codexHistoryBundle(row.id);
      const tag = `${row.provider_id ?? "initial"}-${row.model_id ?? "snapshot"}-${row.id}`;
      downloadString(b.files.authJson, "auth.json", "application/json");
      downloadString(b.files.configToml, "config.toml", "text/plain");
      downloadString(b.scripts.posix, `apply-${tag}.sh`, "text/x-shellscript");
      downloadString(b.scripts.powershell, `apply-${tag}.ps1`, "text/x-powershell");
      msg.success(t("history.bundleSuccess"));
    } catch (err) {
      msg.error((err as Error).message);
    }
  }

  async function onDelete(row: CodexHistoryRow) {
    try {
      await api.codexHistoryDelete(row.id);
      await refresh();
    } catch (err) {
      msg.error((err as Error).message);
    }
  }

  const columns: ColumnsType<CodexHistoryRow> = [
    {
      title: t("history.when"),
      dataIndex: "ts",
      key: "ts",
      render: (v: number) => new Date(v).toLocaleString(),
      width: 180,
    },
    {
      title: t("history.kind"),
      dataIndex: "kind",
      key: "kind",
      render: (v: CodexHistoryRow["kind"]) => <Tag color={KIND_COLOR[v]}>{v}</Tag>,
      width: 90,
    },
    {
      title: t("history.provider"),
      dataIndex: "provider_id",
      key: "provider_id",
      render: (v: string | null) => (v ? <code>{v}</code> : "—"),
    },
    {
      title: t("history.model"),
      dataIndex: "model_id",
      key: "model_id",
      render: (v: string | null) => (v ? <code>{v}</code> : "—"),
    },
    {
      title: t("history.note"),
      dataIndex: "note",
      key: "note",
      render: (v: string | null) => v ?? "",
    },
    {
      title: "",
      key: "actions",
      width: 220,
      render: (_v, row) => (
        <Space>
          <Button
            size="small"
            icon={<CloudDownloadOutlined />}
            onClick={() => void onDownload(row)}
          >
            {t("history.bundle")}
          </Button>
          {row.kind !== "initial" && (
            <Popconfirm title={t("history.deleteConfirm")} onConfirm={() => void onDelete(row)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card
      style={{ marginTop: 16 }}
      title={
        <Space>
          {t("history.title")}
          {authMode === "on" ? (
            <Tag color="purple">{t("history.serverMode")}</Tag>
          ) : (
            <Tag>{t("history.localMode")}</Tag>
          )}
        </Space>
      }
      extra={
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>
          {t("history.refresh")}
        </Button>
      }
    >
      {msgCtx}
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {authMode === "on" ? t("history.descServer") : t("history.descLocal")} {t("history.policy")}
      </Typography.Paragraph>
      <Table<CodexHistoryRow>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        pagination={false}
        size="small"
        loading={loading}
      />
    </Card>
  );
}
