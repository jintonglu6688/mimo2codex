import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  EditOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  api,
  type CodexBundleResponse,
  type CodexDirInfo,
  type CodexState,
} from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";

// Pull `model` and `model_provider` out of a config.toml blob. We only need
// these two fields for the state card display; a full TOML parser would be
// overkill for a regex match on two known keys.
function parseConfigToml(text: string | null): {
  model: string | null;
  provider: string | null;
} {
  if (!text) return { model: null, provider: null };
  const modelMatch = /^\s*model\s*=\s*"([^"\n]+)"/m.exec(text);
  const providerMatch = /^\s*model_provider\s*=\s*"([^"\n]+)"/m.exec(text);
  return {
    model: modelMatch?.[1] ?? null,
    provider: providerMatch?.[1] ?? null,
  };
}

function downloadBlob(content: string, filename: string, mime = "text/plain"): void {
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

export function CurrentStateCard({
  state,
  dirInfo,
  onReload,
}: {
  state: CodexState;
  dirInfo: CodexDirInfo | null;
  onReload: () => void;
}) {
  const { t } = useTranslation("codexEnable");
  const { t: tAuth } = useTranslation("auth");
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const ownerTag =
    state.authJsonOwner === "mimo2codex" ? (
      <Tag color="success">{t("state.owner.mimo2codex")}</Tag>
    ) : state.authJsonOwner === "external" ? (
      <Tag color="warning">{t("state.owner.external")}</Tag>
    ) : (
      <Tag>{t("state.owner.missing")}</Tag>
    );
  const currentToml = parseConfigToml(state.configTomlText);

  return (
    <Card
      title={t("state.title")}
      style={{ marginBottom: 16 }}
      extra={
        <Space>
          <Tooltip title={tAuth("codex.exportTip")} placement="bottomRight">
            <Button
              icon={<CloudDownloadOutlined />}
              onClick={() => setExportOpen(true)}
            >
              {tAuth("codex.exportLocal")}
            </Button>
          </Tooltip>
          <Tooltip title={tAuth("codex.importTip")} placement="bottomRight">
            <Button
              icon={<CloudUploadOutlined />}
              onClick={() => setImportOpen(true)}
            >
              {tAuth("codex.importLocal")}
            </Button>
          </Tooltip>
        </Space>
      }
    >
      <ImportConfigModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          onReload();
        }}
      />
      <ExportGuideModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
      <Descriptions
        column={1}
        bordered
        size="small"
        labelStyle={{ width: 160 }}
        items={[
          {
            key: "codexDir",
            label: t("state.codexDir"),
            children: (
              <CodexDirRow
                effective={state.codexDir}
                dirInfo={dirInfo}
                onReload={onReload}
              />
            ),
          },
          {
            key: "auth",
            label: t("state.authJson"),
            children: (
              <Space>
                {ownerTag}
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  <code>{state.authPath}</code>
                </Typography.Text>
              </Space>
            ),
          },
          {
            key: "toml",
            label: t("state.configToml"),
            children: state.configTomlExists ? (
              <Space wrap>
                {currentToml.provider && (
                  <Tag>
                    {t("state.tomlProvider")}=<code>{currentToml.provider}</code>
                  </Tag>
                )}
                {currentToml.model && (
                  <Tag>
                    {t("state.tomlModel")}=<code>{currentToml.model}</code>
                  </Tag>
                )}
                {!currentToml.provider && !currentToml.model && (
                  <Tag>{t("state.tomlUnknown")}</Tag>
                )}
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  <code>{state.tomlPath}</code>
                </Typography.Text>
              </Space>
            ) : (
              <Tag>{t("state.owner.missing")}</Tag>
            ),
          },
          {
            key: "override",
            label: t("state.override"),
            children: state.activeOverride ? (
              <Tag color="success">
                <code>
                  {state.activeOverride.providerId} /{" "}
                  {state.activeOverride.modelId}
                </code>
              </Tag>
            ) : (
              <Tag>{t("state.overrideNone")}</Tag>
            ),
          },
        ]}
      />
    </Card>
  );
}

// Two-phase modal: shows the full apply-steps guide first; the actual
// download only fires after the user clicks "Download the 4 files". After
// download we keep the modal open and surface the minted m2c key prefix so
// the operator can spot which key is now baked into the auth.json.
function ExportGuideModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("auth");
  const { authMode } = useAuth();
  const isServerMode = authMode === "on";
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<CodexBundleResponse | null>(null);
  const [msg, msgCtx] = message.useMessage();

  // Reset state every time the modal opens so a previous download's result
  // doesn't bleed into a fresh "Click to download" view.
  useEffect(() => {
    if (open) {
      setResult(null);
      setDownloading(false);
    }
  }, [open]);

  async function confirmDownload() {
    setDownloading(true);
    try {
      const b: CodexBundleResponse = await api.codexCurrentBundle();
      const tag = `${b.history.provider_id ?? "config"}-${b.history.model_id ?? "current"}-${b.history.id}`;
      downloadBlob(b.files.authJson, "auth.json", "application/json");
      downloadBlob(b.files.configToml, "config.toml", "text/plain");
      downloadBlob(b.scripts.posix, `apply-${tag}.sh`, "text/x-shellscript");
      downloadBlob(b.scripts.powershell, `apply-${tag}.ps1`, "text/x-powershell");
      setResult(b);
    } catch (err) {
      msg.error((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const downloaded = result !== null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <CloudDownloadOutlined />
          {downloaded ? t("codex.exportDoneTitle") : t("codex.exportTitle")}
        </Space>
      }
      width={640}
      footer={
        downloaded ? (
          <Button type="primary" onClick={onClose}>
            {t("codex.close")}
          </Button>
        ) : (
          <Space>
            <Button onClick={onClose}>{t("codex.cancel")}</Button>
            <Button
              type="primary"
              icon={<CloudDownloadOutlined />}
              loading={downloading}
              onClick={() => void confirmDownload()}
            >
              {t("codex.exportConfirmDownload")}
            </Button>
          </Space>
        )
      }
    >
      {msgCtx}
      <Typography.Paragraph>{t("codex.exportDesc")}</Typography.Paragraph>
      <Typography.Paragraph style={{ marginBottom: 4 }}>
        {t("codex.exportDoneIntro")}
      </Typography.Paragraph>
      <ul style={{ paddingInlineStart: 20, marginTop: 0 }}>
        <li>
          <code>auth.json</code> — {t("codex.exportFile1")}
        </li>
        <li>
          <code>config.toml</code> — {t("codex.exportFile2")}
        </li>
        <li>
          <code>apply-*.sh</code> — {t("codex.exportFile3")}
        </li>
        <li>
          <code>apply-*.ps1</code> — {t("codex.exportFile4")}
        </li>
      </ul>
      <Typography.Title level={5} style={{ marginTop: 16 }}>
        {t("codex.exportSteps")}
      </Typography.Title>
      <ol style={{ paddingInlineStart: 20, marginTop: 0 }}>
        {isServerMode && (
          <li>
            {t("codex.exportStep0")}
            <br />
            <Button
              size="small"
              type="link"
              icon={<KeyOutlined />}
              style={{ paddingInlineStart: 0 }}
              onClick={() => {
                window.location.href = "/admin/account";
              }}
            >
              {t("codex.exportStep0Action")} →
            </Button>
          </li>
        )}
        {isServerMode && <li>{t("codex.exportStep1")}</li>}
        <li>{t("codex.exportStep1b")}</li>
        <li>
          {t("codex.exportStep2Mac")}
          <br />
          {t("codex.exportStep2Win")}
        </li>
        <li>{t("codex.exportStep3")}</li>
        <li>{t("codex.exportStep4")}</li>
      </ol>
      <Alert
        style={{ marginTop: 12 }}
        type={isServerMode ? "warning" : "info"}
        showIcon
        icon={<KeyOutlined />}
        message={t("codex.keyEmphasisTitle")}
        description={
          isServerMode ? (
            <Typography.Text style={{ fontSize: 12 }}>
              {t("codex.keyEmphasisServer")}
              <br />
              <Typography.Text type="secondary">
                {t("codex.keyEmphasisServerMore")}
              </Typography.Text>
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("codex.keyEmphasisLocal")}
            </Typography.Text>
          )
        }
      />
      {downloaded && (
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message={t("codex.exportDownloadedNote")}
        />
      )}
    </Modal>
  );
}

// Two-phase modal: guide → form. Forces the user to read the file-location
// hint + m2c key note before they're allowed to paste content. The form
// phase still has a "Back to guide" button so they can re-check.
function ImportConfigModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useTranslation("auth");
  const [phase, setPhase] = useState<"guide" | "form">("guide");
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [msg, msgCtx] = message.useMessage();

  // Reset to the guide phase whenever the modal reopens so users always see
  // the file-location + m2c key reminder first.
  useEffect(() => {
    if (open) {
      setPhase("guide");
      setBusy(false);
    }
  }, [open]);

  async function onSubmit(values: {
    authJson: string;
    configToml: string;
    providerId?: string;
    modelId?: string;
    note?: string;
  }) {
    try {
      JSON.parse(values.authJson);
    } catch {
      msg.error(t("codex.importInvalidJson"));
      return;
    }
    setBusy(true);
    try {
      const r = await api.codexImport({
        authJson: values.authJson,
        configToml: values.configToml,
        providerId: values.providerId,
        modelId: values.modelId,
        note: values.note,
      });
      msg.success(t("codex.importSuccess", { id: r.historyId }));
      form.resetFields();
      onImported();
    } catch (err) {
      msg.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={
        phase === "guide" ? (
          <Space>
            <Button onClick={onClose}>{t("codex.cancel")}</Button>
            <Button type="primary" onClick={() => setPhase("form")}>
              {t("codex.importNextStep")}
            </Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={() => setPhase("guide")} disabled={busy}>
              {t("codex.importBackToGuide")}
            </Button>
            <Button
              type="primary"
              loading={busy}
              onClick={() => form.submit()}
            >
              {t("codex.importSubmit")}
            </Button>
          </Space>
        )
      }
      title={
        <Space>
          <CloudUploadOutlined />
          {t("codex.importTitle")}
        </Space>
      }
      destroyOnClose
      width={700}
    >
      {msgCtx}
      {phase === "guide" ? (
        <>
          <Typography.Paragraph style={{ marginTop: 0 }}>
            {t("codex.importDesc")}
          </Typography.Paragraph>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 12 }}
            message={t("codex.importGuideTitle")}
            description={
              <div style={{ fontSize: 12 }}>
                <div>
                  <code>{t("codex.importGuideMac")}</code>
                </div>
                <div>
                  <code>{t("codex.importGuideWin")}</code>
                </div>
                <Typography.Text type="secondary">
                  {t("codex.importGuideTip")}
                </Typography.Text>
              </div>
            }
          />
          <Alert
            type="warning"
            showIcon
            icon={<KeyOutlined />}
            message={t("codex.keyEmphasisTitle")}
            description={
              <Typography.Text style={{ fontSize: 12 }}>
                {t("codex.importKeyNote")}
              </Typography.Text>
            }
          />
        </>
      ) : (
        <Form layout="vertical" form={form} onFinish={onSubmit} disabled={busy}>
          <Form.Item label={t("codex.importAuthLabel")} name="authJson" rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} style={{ fontFamily: "monospace" }} />
          </Form.Item>
          <Form.Item label={t("codex.importTomlLabel")} name="configToml" rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} style={{ fontFamily: "monospace" }} />
          </Form.Item>
          <Space style={{ width: "100%" }}>
            <Form.Item label={t("codex.importProviderLabel")} name="providerId" style={{ flex: 1 }}>
              <Input placeholder="mimo" />
            </Form.Item>
            <Form.Item label={t("codex.importModelLabel")} name="modelId" style={{ flex: 1 }}>
              <Input placeholder="mimo-v2.5-pro" />
            </Form.Item>
          </Space>
          <Form.Item label={t("codex.importNoteLabel")} name="note">
            <Input placeholder={t("codex.importNotePlaceholder")} />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}

// Inline edit row for the Codex directory override. Renders read-only by
// default with Edit / Reset buttons; flips to an input+save+cancel form when
// the user clicks Edit.
function CodexDirRow({
  effective,
  dirInfo,
  onReload,
}: {
  effective: string;
  dirInfo: CodexDirInfo | null;
  onReload: () => void;
}) {
  const { t } = useTranslation("codexEnable");
  const { t: tCommon } = useTranslation("common");
  const [messageApi, msgCtx] = message.useMessage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(effective);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whenever the parent reloads (post-save / post-reset) sync the draft so
  // the next edit starts from the new effective value.
  useEffect(() => {
    if (!editing) setDraft(effective);
  }, [effective, editing]);

  const source = dirInfo?.source ?? "default";
  const sourceLabel =
    source === "user"
      ? t("state.codexDirSourceUser")
      : source === "env"
        ? t("state.codexDirSourceEnv")
        : t("state.codexDirSourceDefault");

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(t("state.codexDirPlaceholder"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.setCodexDir(trimmed);
      setEditing(false);
      messageApi.success(t("state.codexDirSaved"));
      onReload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setError(null);
    try {
      await api.clearCodexDir();
      setEditing(false);
      messageApi.success(t("state.codexDirReseted"));
      onReload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <>
        {msgCtx}
        <Space.Compact style={{ width: "100%", maxWidth: 640 }}>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("state.codexDirPlaceholder")}
            disabled={saving}
            onPressEnter={() => void save()}
            autoFocus
          />
          <Button
            type="primary"
            icon={<CheckOutlined />}
            loading={saving}
            onClick={() => void save()}
            title={tCommon("save")}
          />
          <Button
            icon={<CloseOutlined />}
            disabled={saving}
            onClick={() => {
              setEditing(false);
              setDraft(effective);
              setError(null);
            }}
            title={tCommon("cancel")}
          />
        </Space.Compact>
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}
        >
          {t("state.codexDirHelp")}
        </Typography.Paragraph>
        {error && (
          <Typography.Text type="danger" style={{ fontSize: 11 }}>
            {error}
          </Typography.Text>
        )}
      </>
    );
  }

  return (
    <>
      {msgCtx}
      <Space wrap>
        <code>{effective}</code>
        <Tag
          color={
            source === "user" ? "blue" : source === "env" ? "purple" : "default"
          }
        >
          {sourceLabel}
        </Tag>
        <Button
          size="small"
          type="text"
          icon={<EditOutlined />}
          onClick={() => {
            setDraft(effective);
            setEditing(true);
          }}
        >
          {t("state.codexDirEdit")}
        </Button>
        {source === "user" && (
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            loading={saving}
            onClick={() => void reset()}
          >
            {t("state.codexDirReset")}
          </Button>
        )}
      </Space>
    </>
  );
}
