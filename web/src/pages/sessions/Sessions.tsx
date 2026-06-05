import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Drawer,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, BranchesOutlined, EyeOutlined, DownloadOutlined } from "@ant-design/icons";
import {
  api,
  type CodexSession,
  type CodexSessionsResponse,
  type SessionTranscript,
} from "../../api/client";
import { cleanWinPath, middleEllipsis, normalizeCodexTs } from "../../utils/text";
import { TranscriptView, buildTranscriptMarkdown } from "./TranscriptView";

function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatTime(ts: number): string {
  if (!ts) return "—";
  return new Date(normalizeCodexTs(ts)).toLocaleString();
}

// The target-provider Select runs in tags mode (so users can type a new
// provider key), which yields a string[]. Normalize to the single chosen value.
function pickTag(v: unknown): string {
  if (Array.isArray(v)) return String(v[v.length - 1] ?? "");
  return String(v ?? "");
}

export function Sessions() {
  const { t } = useTranslation("sessions");
  const { t: tCommon } = useTranslation("common");
  const [data, setData] = useState<CodexSessionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, modalCtx] = Modal.useModal();
  const [previewOf, setPreviewOf] = useState<CodexSession | null>(null);
  const [transcript, setTranscript] = useState<SessionTranscript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  // Session ids selected for batch migration (spans every per-project table).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.codexSessions());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // provider → project(cwd) → sessions. Normalize the Windows extended-length
  // (\\?\) prefix so the same project doesn't split into two groups.
  const grouped = useMemo(() => {
    const m = new Map<string, Map<string, CodexSession[]>>();
    for (const s of data?.sessions ?? []) {
      const provider = s.provider || "?";
      const project = cleanWinPath(s.cwd) || "?";
      if (!m.has(provider)) m.set(provider, new Map());
      const byProj = m.get(provider)!;
      if (!byProj.has(project)) byProj.set(project, []);
      byProj.get(project)!.push(s);
    }
    return m;
  }, [data]);

  const providerOptions = useMemo(
    () => (data?.providers ?? []).map((p) => ({ value: p, label: p })),
    [data]
  );

  function onMigrate(session: CodexSession) {
    let target = "";
    // Default the picker to the first provider that isn't the current one.
    const others = (data?.providers ?? []).filter((p) => p !== session.provider);
    target = others[0] ?? "";
    modal.confirm({
      title: t("migrateTitle"),
      width: 520,
      okText: t("migrateConfirm"),
      cancelText: tCommon("cancel"),
      content: (
        <div>
          <Alert type="warning" showIcon message={t("migrateBody")} style={{ marginBottom: 12 }} />
          <Typography.Paragraph style={{ marginBottom: 6 }}>
            <Tag>{session.provider}</Tag>→{" "}
            <Typography.Text strong>{t("migrateField")}</Typography.Text>
          </Typography.Paragraph>
          <Select
            defaultValue={target ? [target] : undefined}
            style={{ width: "100%" }}
            placeholder={t("migrateField")}
            options={providerOptions.filter((o) => o.value !== session.provider)}
            showSearch
            onChange={(v) => {
              target = pickTag(v);
            }}
            // Allow typing a brand-new provider key (e.g. a configured but
            // not-yet-used one) in addition to picking an existing one.
            mode="tags"
            maxCount={1}
          />
        </div>
      ),
      onOk: async () => {
        const to = pickTag(target).trim();
        if (!to) {
          setError(t("migrateField"));
          return;
        }
        setError(null);
        setSuccess(null);
        try {
          const resp = await api.codexMigrateSession({ id: session.id, toProvider: to });
          setSuccess(t("migrated", { from: resp.fromProvider, to: resp.toProvider }));
          await load();
        } catch (err) {
          const e = err as Error & { code?: string };
          if (e.message.includes("codex_running") || (e as { status?: number }).status === 409) {
            setError(t("codexRunning"));
          } else {
            setError(e.message);
          }
        }
      },
    });
  }

  function onBatchMigrate() {
    if (selectedIds.length === 0) return;
    let target = (data?.providers ?? [])[0] ?? "";
    modal.confirm({
      title: t("batchMigrateTitle"),
      width: 520,
      okText: t("migrateConfirm"),
      cancelText: tCommon("cancel"),
      content: (
        <div>
          <Alert type="warning" showIcon message={t("migrateBody")} style={{ marginBottom: 12 }} />
          <Typography.Paragraph style={{ marginBottom: 6 }}>
            {t("batchSelected", { count: selectedIds.length })} →{" "}
            <Typography.Text strong>{t("migrateField")}</Typography.Text>
          </Typography.Paragraph>
          <Select
            defaultValue={target ? [target] : undefined}
            style={{ width: "100%" }}
            placeholder={t("migrateField")}
            options={providerOptions}
            showSearch
            mode="tags"
            maxCount={1}
            onChange={(v) => {
              target = pickTag(v);
            }}
          />
        </div>
      ),
      onOk: async () => {
        const to = pickTag(target).trim();
        if (!to) {
          setError(t("migrateField"));
          return;
        }
        setError(null);
        setSuccess(null);
        const ids = [...selectedIds];
        let ok = 0;
        let fail = 0;
        let aborted = false;
        for (const id of ids) {
          try {
            await api.codexMigrateSession({ id, toProvider: to });
            ok++;
          } catch (err) {
            const e = err as Error & { status?: number };
            if (e.message.includes("codex_running") || e.status === 409) {
              aborted = true;
              break;
            }
            fail++;
          }
        }
        await load();
        setSelectedIds([]);
        if (aborted) setError(t("codexRunning"));
        else setSuccess(t("batchResult", { ok, fail }));
      },
    });
  }

  async function onPreview(s: CodexSession) {
    setPreviewOf(s);
    setTranscript(null);
    setTranscriptLoading(true);
    try {
      setTranscript(await api.codexSessionTranscript(s.id));
    } catch (err) {
      setError((err as Error).message);
      setPreviewOf(null);
    } finally {
      setTranscriptLoading(false);
    }
  }

  function onExportMarkdown() {
    if (!transcript || !previewOf) return;
    const title = previewOf.title || previewOf.firstUserMessage || previewOf.id;
    const md = buildTranscriptMarkdown(
      title,
      { model: transcript.model, cwd: transcript.cwd },
      transcript.items,
      {
        you: t("you"),
        assistant: t("assistant"),
        ctx: t("ctx"),
        reasoning: t("reasoning"),
        output: t("toolOutput"),
      }
    );
    const safe = (title || "codex-session").replace(/[^\w一-龥.-]+/g, "_").slice(0, 60);
    downloadText(md, `${safe}.md`);
  }

  function columns(): ColumnsType<CodexSession> {
    return [
      {
        title: t("col.title"),
        dataIndex: "title",
        key: "title",
        ellipsis: true,
        render: (_: string, s) => {
          const raw = s.title || s.firstUserMessage || t("untitled");
          return (
            <Space size={6} style={{ maxWidth: "100%" }}>
              <span
                title={raw}
                style={{ whiteSpace: "nowrap", overflow: "hidden" }}
              >
                {middleEllipsis(raw, 90)}
              </span>
              {s.archived && <Tag>{t("archived")}</Tag>}
            </Space>
          );
        },
      },
      {
        title: t("col.updated"),
        dataIndex: "updatedAt",
        key: "updatedAt",
        width: 200,
        render: (v: number) => formatTime(v),
      },
      {
        title: t("col.tokens"),
        dataIndex: "tokensUsed",
        key: "tokensUsed",
        width: 110,
        align: "right",
        render: (v: number) => (v ? v.toLocaleString() : "—"),
      },
      {
        title: t("col.actions"),
        key: "actions",
        width: 200,
        render: (_, s) => (
          <Space size={4}>
            <Button size="small" icon={<EyeOutlined />} onClick={() => void onPreview(s)}>
              {t("preview")}
            </Button>
            <Button size="small" icon={<BranchesOutlined />} onClick={() => onMigrate(s)}>
              {t("migrate")}
            </Button>
          </Space>
        ),
      },
    ];
  }

  return (
    <>
      {modalCtx}
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        {t("title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{t("intro")}</Typography.Paragraph>

      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} size="small" loading={loading} onClick={() => void load()}>
          {t("refresh")}
        </Button>
      </Space>

      {error && (
        <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} style={{ marginBottom: 16 }} />
      )}
      {success && (
        <Alert type="success" showIcon message={success} closable onClose={() => setSuccess(null)} style={{ marginBottom: 16 }} />
      )}

      {data?.localOnly && (
        <Alert type="info" showIcon message={t("localOnly")} style={{ marginBottom: 16 }} />
      )}

      {data && !data.localOnly && !data.available && (
        <Alert type="warning" showIcon message={t("unavailable")} style={{ marginBottom: 16 }} />
      )}

      {data && data.available && (
        <>
          <Alert type="warning" showIcon message={t("danger")} style={{ marginBottom: 16 }} />
          {selectedIds.length > 0 && (
            <Space style={{ marginBottom: 12 }}>
              <Tag color="blue">{t("batchSelected", { count: selectedIds.length })}</Tag>
              <Button
                type="primary"
                size="small"
                icon={<BranchesOutlined />}
                onClick={onBatchMigrate}
              >
                {t("batchMigrate")}
              </Button>
              <Button size="small" onClick={() => setSelectedIds([])}>
                {t("batchClear")}
              </Button>
            </Space>
          )}
          {data.sessions.length === 0 ? (
            <Typography.Text type="secondary">{t("empty")}</Typography.Text>
          ) : (
            <Collapse
              defaultActiveKey={Array.from(grouped.keys()).slice(0, 1)}
              items={Array.from(grouped.entries()).map(([provider, byProj]) => {
                const count = Array.from(byProj.values()).reduce((a, b) => a + b.length, 0);
                return {
                  key: provider,
                  label: (
                    <Space>
                      <Tag color="blue">{t("group.provider")}: {provider}</Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t("group.sessions", { count })}
                      </Typography.Text>
                    </Space>
                  ),
                  children: (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      {Array.from(byProj.entries()).map(([project, sessions]) => (
                        <Card
                          key={project}
                          size="small"
                          title={
                            <Space style={{ maxWidth: "100%" }}>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {t("group.project")}:
                              </Typography.Text>
                              <code style={{ fontSize: 12 }} title={project}>
                                {middleEllipsis(project, 70)}
                              </code>
                            </Space>
                          }
                        >
                          <Table<CodexSession>
                            rowKey="id"
                            size="small"
                            dataSource={sessions}
                            columns={columns()}
                            pagination={false}
                            rowSelection={{
                              selectedRowKeys: sessions
                                .filter((s) => selectedIds.includes(s.id))
                                .map((s) => s.id),
                              onChange: (keys) => {
                                const tableIds = new Set(sessions.map((s) => s.id));
                                setSelectedIds((prev) => [
                                  ...prev.filter((id) => !tableIds.has(id)),
                                  ...keys.map(String),
                                ]);
                              },
                            }}
                          />
                        </Card>
                      ))}
                    </Space>
                  ),
                };
              })}
            />
          )}
        </>
      )}

      <Drawer
        open={previewOf !== null}
        onClose={() => setPreviewOf(null)}
        width={Math.min(820, typeof window !== "undefined" ? window.innerWidth - 40 : 820)}
        title={
          <Space direction="vertical" size={0} style={{ maxWidth: "70%" }}>
            <span title={previewOf?.title}>
              {middleEllipsis(previewOf?.title || previewOf?.firstUserMessage || previewOf?.id || "", 60)}
            </span>
            {transcript?.model && (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {transcript.model}
              </Typography.Text>
            )}
          </Space>
        }
        extra={
          <Button
            icon={<DownloadOutlined />}
            disabled={!transcript?.available || (transcript?.items.length ?? 0) === 0}
            onClick={onExportMarkdown}
          >
            {t("exportMd")}
          </Button>
        }
      >
        {transcriptLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin tip={t("transcriptLoading")} />
          </div>
        ) : !transcript || !transcript.available ? (
          <Alert type="warning" showIcon message={t("transcriptUnavailable")} />
        ) : transcript.items.length === 0 ? (
          <Typography.Text type="secondary">{t("transcriptEmpty")}</Typography.Text>
        ) : (
          <TranscriptView items={transcript.items} />
        )}
      </Drawer>
    </>
  );
}
