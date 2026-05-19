import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { CopyOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  api,
  type ApiKeyRow,
  type ProviderInfo,
  type UpstreamKeySummary,
} from "../api/client";
import { useAuth } from "../contexts/AuthContext";

const { Title, Paragraph } = Typography;

export function AccountPage(): JSX.Element {
  const { t } = useTranslation("auth");
  const { user } = useAuth();
  return (
    <div style={{ padding: "24px 28px", maxWidth: 920, margin: "0 auto" }}>
      <Title level={3}>{t("account.title")}</Title>
      <Paragraph type="secondary">{t("account.description")}</Paragraph>
      <ApiKeysSection />
      <BYOKSection />
      {user?.is_admin && <OAuthAdminSection />}
    </div>
  );
}

function ApiKeysSection() {
  const { t } = useTranslation("auth");
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [msg, msgCtx] = message.useMessage();

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.meApiKeys();
      setRows(r.api_keys);
    } catch (err) {
      msg.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate() {
    setCreating(true);
    try {
      // Empty name → auto-generate a timestamped one so the user always gets
      // a key (was previously a silent no-op, which read as a broken button).
      const trimmed = name.trim();
      const finalName = trimmed || `key-${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}`;
      const r = await api.meCreateApiKey(finalName);
      setRevealed(r.token);
      setName("");
      await refresh();
    } catch (err) {
      msg.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(id: number) {
    try {
      await api.meRevokeApiKey(id);
      await refresh();
    } catch (err) {
      msg.error((err as Error).message);
    }
  }

  const columns: ColumnsType<ApiKeyRow> = [
    { title: t("account.apiKeys.name"), dataIndex: "name", key: "name" },
    {
      title: t("account.apiKeys.prefix"),
      dataIndex: "key_prefix",
      key: "key_prefix",
      render: (v: string) => <code>{v}…</code>,
    },
    {
      title: t("account.apiKeys.created"),
      dataIndex: "created_at",
      key: "created_at",
      render: (v: number) => new Date(v).toLocaleString(),
    },
    {
      title: t("account.apiKeys.lastUsed"),
      dataIndex: "last_used_at",
      key: "last_used_at",
      render: (v: number | null) => (v ? new Date(v).toLocaleString() : t("account.apiKeys.empty")),
    },
    {
      title: t("account.apiKeys.status"),
      dataIndex: "revoked_at",
      key: "status",
      render: (v: number | null) =>
        v ? (
          <Tag color="default">{t("account.apiKeys.revoked")}</Tag>
        ) : (
          <Tag color="success">{t("account.apiKeys.active")}</Tag>
        ),
    },
    {
      title: "",
      key: "actions",
      render: (_v, row) =>
        row.revoked_at == null && (
          <Popconfirm title={t("account.apiKeys.revokeConfirm")} onConfirm={() => onRevoke(row.id)}>
            <Button danger size="small" icon={<DeleteOutlined />}>
              {t("account.apiKeys.revoke")}
            </Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <Card style={{ marginTop: 24 }} title={t("account.apiKeys.title")}>
      {msgCtx}
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("account.apiKeys.subtitle")}
      </Paragraph>
      {revealed && (
        <Alert
          type="success"
          showIcon
          message={t("account.apiKeys.createdAlert")}
          description={
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input.TextArea readOnly value={revealed} autoSize style={{ fontFamily: "monospace" }} />
              <Space>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    void navigator.clipboard.writeText(revealed);
                    msg.success(t("account.apiKeys.copied"));
                  }}
                >
                  {t("account.apiKeys.copy")}
                </Button>
                <Button size="small" onClick={() => setRevealed(null)}>
                  {t("account.apiKeys.dismiss")}
                </Button>
              </Space>
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      <Space style={{ marginBottom: 12 }}>
        <Input
          placeholder={t("account.apiKeys.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={() => void onCreate()}
          style={{ width: 280 }}
        />
        <Button type="primary" icon={<PlusOutlined />} loading={creating} onClick={() => void onCreate()}>
          {t("account.apiKeys.create")}
        </Button>
      </Space>
      <Table<ApiKeyRow>
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

function OAuthAdminSection() {
  const { t } = useTranslation("auth");
  const [clients, setClients] = useState<Awaited<ReturnType<typeof api.oauthClients>>["clients"]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, msgCtx] = message.useMessage();

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.oauthClients();
      setClients(r.clients);
    } catch (err) {
      msg.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Card style={{ marginTop: 24 }} title={t("account.oauth.title")} loading={loading}>
      {msgCtx}
      <Paragraph type="secondary">{t("account.oauth.description")}</Paragraph>
      {(["github", "gitee"] as const).map((provider) => {
        const existing = clients.find((c) => c.provider === provider);
        return (
          <OAuthProviderForm
            key={provider}
            provider={provider}
            existing={existing}
            onSaved={() => void refresh()}
          />
        );
      })}
    </Card>
  );
}

function OAuthProviderForm({
  provider,
  existing,
  onSaved,
}: {
  provider: "github" | "gitee";
  existing?: { client_id: string; callback_url: string; enabled: boolean; has_secret: boolean };
  onSaved: () => void;
}) {
  const { t } = useTranslation("auth");
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [msg, msgCtx] = message.useMessage();

  useEffect(() => {
    form.setFieldsValue({
      clientId: existing?.client_id ?? "",
      callbackUrl: existing?.callback_url ?? "",
      enabled: !!existing?.enabled,
      clientSecret: "",
    });
  }, [existing, form]);

  async function onFinish(values: {
    clientId: string;
    callbackUrl: string;
    enabled: boolean;
    clientSecret?: string;
  }) {
    setBusy(true);
    try {
      await api.saveOAuthClient(provider, {
        clientId: values.clientId,
        clientSecret: values.clientSecret && values.clientSecret.length > 0 ? values.clientSecret : null,
        callbackUrl: values.callbackUrl,
        enabled: !!values.enabled,
      });
      msg.success(t("account.oauth.saved"));
      onSaved();
    } catch (err) {
      msg.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    try {
      await api.deleteOAuthClient(provider);
      onSaved();
    } catch (err) {
      msg.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16, padding: 12, border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8 }}>
      {msgCtx}
      <div style={{ marginBottom: 8 }}>
        <strong style={{ textTransform: "capitalize" }}>{provider}</strong>
        {existing && (
          <Tag color={existing.enabled ? "success" : "default"} style={{ marginInlineStart: 8 }}>
            {existing.enabled ? t("account.oauth.enabled") : t("account.oauth.disabled")}
          </Tag>
        )}
      </div>
      <Form layout="vertical" form={form} onFinish={onFinish} disabled={busy} size="small">
        <Form.Item label={t("account.oauth.clientId")} name="clientId" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item
          label={
            existing?.has_secret
              ? t("account.oauth.clientSecretKeep")
              : t("account.oauth.clientSecret")
          }
          name="clientSecret"
          rules={existing?.has_secret ? [] : [{ required: true }]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item label={t("account.oauth.callbackUrl")} name="callbackUrl" rules={[{ required: true }]}>
          <Input placeholder={t("account.oauth.callbackPlaceholder", { provider })} />
        </Form.Item>
        <Form.Item label={t("account.oauth.enable")} name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" loading={busy}>
            {t("account.oauth.save")}
          </Button>
          {existing && (
            <Popconfirm
              title={t("account.oauth.removeConfirm", { provider })}
              onConfirm={onDelete}
            >
              <Button danger disabled={busy}>
                {t("account.oauth.remove")}
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Form>
    </div>
  );
}

function BYOKSection() {
  const { t } = useTranslation("auth");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [byok, setByok] = useState<UpstreamKeySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [msg, msgCtx] = message.useMessage();

  async function refresh() {
    setLoading(true);
    try {
      const [p, k] = await Promise.all([api.providers(), api.meUpstreamKeys()]);
      setProviders(p.providers);
      setByok(k.upstream_keys);
    } catch (err) {
      msg.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onSave(providerId: string) {
    if (!value.trim()) return;
    try {
      await api.meSetUpstreamKey(providerId, value.trim());
      msg.success(t("account.byok.saved"));
      setEditing(null);
      setValue("");
      await refresh();
    } catch (err) {
      msg.error((err as Error).message);
    }
  }

  async function onClear(providerId: string) {
    try {
      await api.meDeleteUpstreamKey(providerId);
      await refresh();
    } catch (err) {
      msg.error((err as Error).message);
    }
  }

  return (
    <Card style={{ marginTop: 24 }} title={t("account.byok.title")} loading={loading}>
      {msgCtx}
      <Paragraph type="secondary">{t("account.byok.subtitle")}</Paragraph>
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t("account.byok.encrypted")}
      </Paragraph>
      {providers.map((p) => {
        const has = byok.find((b) => b.provider_id === p.id);
        const isEditing = editing === p.id;
        return (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 0",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
              gap: 12,
            }}
          >
            <div style={{ flex: "0 0 180px" }}>
              <strong>{p.display_name}</strong>
              <div style={{ fontSize: 12, opacity: 0.6 }}>{p.id}</div>
            </div>
            <div style={{ flex: "1 1 auto" }}>
              {isEditing ? (
                <Space.Compact style={{ width: "100%" }}>
                  <Input.Password
                    placeholder={t("account.byok.placeholder", { envKey: p.api_key_env[0] })}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onPressEnter={() => void onSave(p.id)}
                  />
                  <Button type="primary" onClick={() => void onSave(p.id)}>
                    {t("account.byok.save")}
                  </Button>
                  <Button onClick={() => { setEditing(null); setValue(""); }}>
                    {t("account.byok.cancel")}
                  </Button>
                </Space.Compact>
              ) : has ? (
                <Typography.Text type="secondary">
                  <Tag color="success">{t("account.byok.configured")}</Tag>{" "}
                  {t("account.byok.updated")} {new Date(has.updated_at).toLocaleString()}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary">{t("account.byok.usingShared")}</Typography.Text>
              )}
            </div>
            <div style={{ flex: "0 0 auto" }}>
              {!isEditing && (
                <Space>
                  <Button size="small" onClick={() => { setEditing(p.id); setValue(""); }}>
                    {has ? t("account.byok.replace") : t("account.byok.set")}
                  </Button>
                  {has && (
                    <Popconfirm title={t("account.byok.removeConfirm")} onConfirm={() => onClear(p.id)}>
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                </Space>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
