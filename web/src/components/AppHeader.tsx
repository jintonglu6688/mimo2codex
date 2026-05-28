import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dropdown,
  Layout,
  Modal,
  Popover,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  message,
  theme as antdTheme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleFilled,
  DesktopOutlined,
  KeyOutlined,
  LogoutOutlined,
  SettingOutlined,
  UserOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { api, type MappingRow, type ProviderInfo } from "../api/client";
import DataDirManager from "./DataDirManager";
import {
  useAppConfig,
  type ThemeMode,
} from "../contexts/AppConfigContext";
import { useAuth } from "../contexts/AuthContext";
import { SUPPORTED_LANGS, type SupportedLang } from "../i18n";

const { Header } = Layout;

const THEME_MODES: ThemeMode[] = ["dark", "light", "auto"];

// Modal section currently displayed. null = no modal open.
type Section = "providers" | "mappings" | "dataDir";

// Refresh interval for the global key status indicator. 30s keeps the chip
// reasonably fresh after a user `export KEY=` + restart cycle without
// hammering the providers endpoint.
const KEY_STATUS_POLL_MS = 30_000;

export function AppHeader() {
  const { t } = useTranslation("settings");
  const { t: tKey } = useTranslation("keyBanner");
  const { themeMode, lang, refresh } = useAppConfig();
  const { token } = antdTheme.useToken();
  const [messageApi, msgCtx] = message.useMessage();
  const [section, setSection] = useState<Section | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  // Whether this admin UI is running inside the Electron desktop shell — set
  // by the /desktop/sentinel endpoint at mount. null while loading; once we
  // know, we either show the "Open Desktop Settings" button (true) or not
  // (false / fetch error). See package/desktop/src/signalWatcher.ts.
  const [inDesktop, setInDesktop] = useState<boolean | null>(null);

  // Pull provider key status on mount + every 30s so the chip stays in sync
  // when users add keys / restart out-of-band. Failures are silent — chip
  // just stays on its last-known state rather than throwing in the header.
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const r = await api.providers();
        if (!cancelled) setProviders(r.providers);
      } catch {
        /* keep last-known state */
      }
    }
    void pull();
    const tid = setInterval(pull, KEY_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(tid);
    };
  }, []);

  // Probe the desktop sentinel once on mount. The flag never changes during
  // a process lifetime, so no polling is needed. Fetch errors → render
  // nothing (treat as not-in-desktop), which is the safe default.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.desktopSentinel();
        if (!cancelled) setInDesktop(r.inDesktop);
      } catch {
        if (!cancelled) setInDesktop(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openDesktopSettings() {
    try {
      await api.desktopSignal("open-settings");
    } catch (err) {
      messageApi.error((err as Error).message);
    }
  }

  async function saveSetting(key: string, value: string) {
    try {
      await api.setSetting(key, value);
      await refresh();
      messageApi.success(t("ui.saved", { key }));
    } catch (err) {
      messageApi.error((err as Error).message);
    }
  }

  const missing = providers.filter((p) => !p.api_key_present);
  const allOk = providers.length > 0 && missing.length === 0;

  return (
    <Header
      style={{
        height: 44,
        lineHeight: "44px",
        padding: "0 20px",
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 16,
      }}
    >
      {msgCtx}
      <KeyStatusIndicator
        providers={providers}
        missing={missing}
        allOk={allOk}
        tKey={tKey}
      />
      <Space size={6}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("ui.theme")}:
        </Typography.Text>
        <Segmented<ThemeMode>
          size="small"
          value={themeMode}
          options={THEME_MODES.map((m) => ({
            label: t(`ui.themeOption.${m}`),
            value: m,
          }))}
          onChange={(v) => void saveSetting("ui.theme", v)}
        />
      </Space>
      <Space size={6}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("ui.lang")}:
        </Typography.Text>
        <Segmented<SupportedLang>
          size="small"
          value={lang}
          options={SUPPORTED_LANGS.map((l) => ({ label: l, value: l }))}
          onChange={(v) => void saveSetting("ui.lang", v)}
        />
      </Space>
      <Dropdown
        menu={{
          items: [
            { key: "providers", label: t("modal.providers") },
            { key: "mappings", label: t("modal.mappings") },
            { key: "dataDir", label: t("modal.dataDir") },
          ],
          onClick: ({ key }) => setSection(key as Section),
        }}
        trigger={["click"]}
      >
        <Button size="small" icon={<SettingOutlined />}>
          {t("modal.openBtn")}
        </Button>
      </Dropdown>
      {inDesktop && (
        <Button
          size="small"
          icon={<DesktopOutlined />}
          onClick={() => void openDesktopSettings()}
          title={t("ui.desktopSettingsTooltip", {
            defaultValue:
              "Open the Electron Settings window (API keys, port, autostart, …)",
          })}
        >
          {t("ui.desktopSettings", { defaultValue: "Desktop Settings" })}
        </Button>
      )}
      <UserMenu />
      <SectionModal section={section} onClose={() => setSection(null)} />
    </Header>
  );
}

// Renders nothing in local mode (authMode='off'). In server mode shows the
// current display name + a sign-out item. Account / Users links are added in
// the BYOK + user-management iteration; placeholders kept off the menu for
// now so we don't show dead links.
function UserMenu() {
  const { authMode, user, logout } = useAuth();
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  if (authMode === "off" || !user) return null;
  const display = user.display_name || user.username;
  return (
    <Dropdown
      menu={{
        items: [
          {
            key: "account",
            icon: <KeyOutlined />,
            label: t("header.account"),
            onClick: () => navigate("/account"),
          },
          { type: "divider" },
          {
            key: "logout",
            icon: <LogoutOutlined />,
            label: t("header.logout"),
            onClick: () => void logout(),
          },
        ],
      }}
      trigger={["click"]}
    >
      <Button size="small" icon={<UserOutlined />}>
        {display}
        {user.is_admin && (
          <Tag color="blue" style={{ marginInlineStart: 6 }}>
            admin
          </Tag>
        )}
      </Button>
    </Dropdown>
  );
}

function KeyStatusIndicator({
  providers,
  missing,
  allOk,
  tKey,
}: {
  providers: ProviderInfo[];
  missing: ProviderInfo[];
  allOk: boolean;
  tKey: (k: string, opts?: Record<string, unknown>) => string;
}) {
  // Empty state: providers not loaded yet — render nothing rather than a
  // stale "all ok" / "missing" guess.
  if (providers.length === 0) return null;

  if (allOk) {
    return (
      <Tag
        icon={<CheckCircleFilled />}
        color="success"
        style={{ marginInlineEnd: 0, cursor: "default" }}
      >
        {tKey("allOkShort")}
      </Tag>
    );
  }

  const firstEnv = missing[0]?.api_key_env[0];
  const content = (
    <div style={{ maxWidth: 420 }}>
      <div style={{ marginBottom: 6 }}>
        <strong>{tKey("missingTitle")}</strong>{" "}
        {missing.map((p) => p.display_name).join(", ")}
      </div>
      <div style={{ fontSize: 12 }}>{tKey("missingHint")}</div>
      <ul style={{ margin: "6px 0 0 0", paddingLeft: 20 }}>
        {missing.map((p) => (
          <li key={p.id} style={{ fontSize: 12 }}>
            {p.display_name}: <code>{p.api_key_env.join(" / ")}</code>
          </li>
        ))}
      </ul>
      {firstEnv && (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          {tKey("exampleLabel")}
          <br />
          {tKey("macLinux")}: <code>export {firstEnv}=sk-xxxxxx</code>
          <br />
          {tKey("windows")}: <code>$env:{firstEnv}="sk-xxxxxx"</code>
        </div>
      )}
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomRight">
      <Tag
        className="m2c-key-pulse"
        icon={<WarningFilled />}
        color="warning"
        style={{ marginInlineEnd: 0, cursor: "pointer" }}
      >
        {tKey("missingShort", { count: missing.length })}
      </Tag>
    </Popover>
  );
}

function SectionModal({
  section,
  onClose,
}: {
  section: Section | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("settings");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Lazy-load only what's needed for the current section, so a single open
  // doesn't fan out to multiple /admin/api/* calls when the user only wants
  // one of them. The dataDir section owns its own loading (see DataDirManager)
  // since it has its own async flows (preview + SSE migrate).
  useEffect(() => {
    if (section === null) return;
    if (section === "dataDir") return;
    setLoading(true);
    const fetch =
      section === "providers"
        ? api.providers().then((r) => setProviders(r.providers))
        : api.mappings().then((r) => setMappings(r.mappings));
    void fetch.finally(() => setLoading(false));
  }, [section]);

  const providerColumns: ColumnsType<ProviderInfo> = [
    {
      title: t("providers.columns.provider"),
      dataIndex: "display_name",
      key: "provider",
      render: (name: string, row) => (
        <Space>
          <strong>{name}</strong>
          {row.default && <Tag color="blue">{t("providers.tag.default")}</Tag>}
        </Space>
      ),
    },
    {
      title: t("providers.columns.status"),
      dataIndex: "api_key_present",
      key: "status",
      render: (present: boolean) =>
        present ? (
          <Tag color="success">{t("providers.tag.keyPresent")}</Tag>
        ) : (
          <Tag color="warning">{t("providers.tag.keyMissing")}</Tag>
        ),
    },
    {
      title: t("providers.columns.baseUrl"),
      dataIndex: "base_url",
      key: "base_url",
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: t("providers.columns.defaultModel"),
      dataIndex: "default_model",
      key: "default_model",
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: t("providers.columns.envVar"),
      dataIndex: "api_key_env",
      key: "env",
      render: (env: string[]) => <code>{env.join(", ")}</code>,
    },
  ];

  const mappingColumns: ColumnsType<MappingRow> = [
    {
      title: t("mappings.columns.provider"),
      dataIndex: "provider_id",
      key: "provider_id",
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: t("mappings.columns.clientModel"),
      dataIndex: "client_model",
      key: "client_model",
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: t("mappings.columns.upstreamModel"),
      dataIndex: "upstream_model",
      key: "upstream_model",
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: t("mappings.columns.count"),
      dataIndex: "count",
      key: "count",
      align: "right",
    },
    {
      title: t("mappings.columns.lastSeen"),
      dataIndex: "last_seen",
      key: "last_seen",
      render: (v: number) => new Date(v).toLocaleString(),
    },
  ];

  const titleMap: Record<Section, string> = {
    providers: t("modal.providers"),
    mappings: t("modal.mappings"),
    dataDir: t("modal.dataDir"),
  };

  const widthMap: Record<Section, number> = {
    providers: 880,
    mappings: 880,
    dataDir: 640,
  };

  return (
    <Modal
      open={section !== null}
      onCancel={onClose}
      onOk={onClose}
      title={section ? titleMap[section] : ""}
      footer={null}
      width={section ? widthMap[section] : 520}
      destroyOnClose
    >
      {section === "providers" && (
        <>
          <Table<ProviderInfo>
            rowKey="id"
            dataSource={providers}
            columns={providerColumns}
            pagination={false}
            size="small"
            loading={loading}
          />
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}
          >
            {t("apiKey.info")} <code>MIMO_API_KEY</code> ·{" "}
            <code>DS_API_KEY</code> / <code>DEEPSEEK_API_KEY</code>
          </Typography.Paragraph>
        </>
      )}

      {section === "mappings" && (
        <>
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginTop: 0 }}
          >
            {t("mappings.subtitle")}
          </Typography.Paragraph>
          <Table<MappingRow>
            rowKey={(r) =>
              `${r.provider_id}-${r.client_model}-${r.upstream_model}`
            }
            dataSource={mappings}
            columns={mappingColumns}
            pagination={false}
            size="small"
            loading={loading}
            locale={{ emptyText: t("mappings.empty") }}
          />
        </>
      )}

      {section === "dataDir" && <DataDirManager />}
    </Modal>
  );
}
