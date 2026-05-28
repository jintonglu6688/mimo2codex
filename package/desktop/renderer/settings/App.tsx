import { useEffect, useState } from "react";
import {
  Form,
  Input,
  InputNumber,
  Checkbox,
  Button,
  Space,
  Typography,
  Alert,
  Card,
  Divider,
  Tag,
} from "antd";
import type { LegacyEnvProbe, RuntimeConfig } from "../../shared/types.js";
import { PROVIDER_SPECS } from "../../shared/types.js";

interface LoadedState {
  runtime: RuntimeConfig;
  env: Record<string, string>;
  isFirstRun: boolean;
  userDataDir: string;
  legacyEnv: LegacyEnvProbe | null;
}

// Per-provider form fields. Empty string means "not set"; on save we write
// the empty value back so writeEnv clears the line (it ALWAYS writes what we
// pass), letting users disable a provider by clearing its API key.
interface ProviderFields {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

function emptyProviderFields(): ProviderFields {
  return { apiKey: "", baseUrl: "", defaultModel: "" };
}

function fieldsFromEnv(env: Record<string, string>): Record<string, ProviderFields> {
  const out: Record<string, ProviderFields> = {};
  for (const spec of PROVIDER_SPECS) {
    out[spec.provider] = {
      apiKey: env[spec.keyEnv] ?? "",
      baseUrl: env[spec.baseUrlEnv] ?? "",
      defaultModel: spec.defaultModelEnv ? (env[spec.defaultModelEnv] ?? "") : "",
    };
  }
  return out;
}

export function App() {
  const [state, setState] = useState<LoadedState | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderFields>>(() => {
    const init: Record<string, ProviderFields> = {};
    for (const spec of PROVIDER_SPECS) init[spec.provider] = emptyProviderFields();
    return init;
  });
  const [port, setPort] = useState(8788);
  const [dataDir, setDataDirField] = useState("");
  const [autostart, setAutostartFlag] = useState(false);
  const [showAdminAfter, setShowAdminAfter] = useState(true);
  const [importResult, setImportResult] = useState<{
    imported: string[];
    skipped: string[];
    sourcePath: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const off = window.m2c.on((msg) => {
      if (msg.type === "settings:loaded") {
        setState(msg.payload);
        setPort(msg.payload.runtime.port);
        setDataDirField(msg.payload.userDataDir);
        setAutostartFlag(msg.payload.runtime.autostart);
        setProviders(fieldsFromEnv(msg.payload.env));
      } else if (msg.type === "settings:dataDirChosen") {
        if (msg.payload.path) setDataDirField(msg.payload.path);
      } else if (msg.type === "settings:legacyImported") {
        setImporting(false);
        setImportResult({
          imported: Object.keys(msg.payload.imported),
          skipped: Object.keys(msg.payload.skipped),
          sourcePath: msg.payload.sourcePath,
        });
        // Merge imported values into the form so the user can review before
        // hitting Save & Restart. Skipped keys are NOT merged — the desktop
        // already had its own value.
        setState((s) =>
          s ? { ...s, env: { ...s.env, ...msg.payload.imported }, legacyEnv: null } : s
        );
        setProviders((p) => {
          const merged: Record<string, ProviderFields> = { ...p };
          const e = msg.payload.imported;
          for (const spec of PROVIDER_SPECS) {
            const next = { ...merged[spec.provider] };
            if (e[spec.keyEnv]) next.apiKey = e[spec.keyEnv];
            if (e[spec.baseUrlEnv]) next.baseUrl = e[spec.baseUrlEnv];
            if (spec.defaultModelEnv && e[spec.defaultModelEnv])
              next.defaultModel = e[spec.defaultModelEnv];
            merged[spec.provider] = next;
          }
          return merged;
        });
      }
    });
    window.m2c.send({ type: "settings:load" });
    return off;
  }, []);

  if (!state) return <div style={{ padding: 24 }}>Loading…</div>;

  const updateProvider = (provider: string, patch: Partial<ProviderFields>) => {
    setProviders((p) => ({ ...p, [provider]: { ...p[provider], ...patch } }));
  };

  const onImportLegacy = () => {
    setImporting(true);
    window.m2c.send({ type: "settings:importLegacy" });
  };

  const onSave = () => {
    // Build the env diff. We always pass the current form values for every
    // known key, including empty strings (writeEnv replaces the line with
    // KEY=""), so users can clear a key from the UI. Unknown keys (proxy
    // vars, master key) in the original env are preserved by writeEnv.
    const envOut: Record<string, string> = { ...state.env };
    for (const spec of PROVIDER_SPECS) {
      const f = providers[spec.provider];
      envOut[spec.keyEnv] = f.apiKey.trim();
      envOut[spec.baseUrlEnv] = f.baseUrl.trim();
      if (spec.defaultModelEnv) envOut[spec.defaultModelEnv] = f.defaultModel.trim();
    }
    window.m2c.send({
      type: "settings:save",
      payload: {
        runtime: { ...state.runtime, port, autostart },
        env: envOut,
        dataDir: dataDir.trim(),
        showAdminUiAfterSave: showAdminAfter,
      },
    });
  };

  const onBrowseDataDir = () => {
    window.m2c.chooseDataDir();
  };

  const onCancel = () => {
    window.m2c.send({ type: "settings:cancel", payload: { isFirstRun: state.isFirstRun } });
  };

  const usableProviders = PROVIDER_SPECS.filter((s) => providers[s.provider].apiKey.trim().length > 0).length;
  const canSave = usableProviders > 0 && port > 0 && port < 65536 && dataDir.trim().length > 0;

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {state.isFirstRun ? "Welcome to mimo2codex" : "Settings"}
      </Typography.Title>

      {state.isFirstRun && (
        <Alert
          type="info"
          showIcon
          message="Set at least one provider's API key to get started. You can fill multiple — mimo2codex routes per request based on the `model` field."
          style={{ marginBottom: 16 }}
        />
      )}

      {state.legacyEnv && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message="Detected an existing CLI config"
          description={
            <div>
              <div>
                Found <code>{state.legacyEnv.sourcePath}</code> with{" "}
                <strong>{state.legacyEnv.keys.length}</strong> key(s):{" "}
                {state.legacyEnv.keys.map((k) => (
                  <Tag key={k} style={{ marginBottom: 4 }}>
                    {k}
                  </Tag>
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                <Button
                  type="primary"
                  size="small"
                  loading={importing}
                  onClick={onImportLegacy}
                >
                  Import all into desktop
                </Button>
                <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 12 }}>
                  Existing desktop values won't be overwritten.
                </Typography.Text>
              </div>
            </div>
          }
        />
      )}

      {importResult && (
        <Alert
          type="info"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          message={`Imported ${importResult.imported.length} key(s)${importResult.skipped.length > 0 ? `, skipped ${importResult.skipped.length} (already set)` : ""}`}
          description={
            <div style={{ fontSize: 12 }}>
              {importResult.imported.length > 0 && (
                <div>
                  Imported: {importResult.imported.map((k) => <Tag key={k}>{k}</Tag>)}
                </div>
              )}
              {importResult.skipped.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  Skipped (already set in desktop):{" "}
                  {importResult.skipped.map((k) => <Tag key={k}>{k}</Tag>)}
                </div>
              )}
              <div style={{ marginTop: 4, color: "#888" }}>
                Source: <code>{importResult.sourcePath}</code>
              </div>
            </div>
          }
          onClose={() => setImportResult(null)}
        />
      )}

      <Form layout="vertical">
        {PROVIDER_SPECS.map((spec) => {
          const f = providers[spec.provider];
          return (
            <Card
              key={spec.provider}
              size="small"
              title={spec.label}
              style={{ marginBottom: 12 }}
            >
              <Form.Item label="API Key" style={{ marginBottom: 8 }}>
                <Input.Password
                  value={f.apiKey}
                  placeholder={spec.keyHint}
                  onChange={(e) => updateProvider(spec.provider, { apiKey: e.target.value })}
                />
              </Form.Item>
              <Form.Item
                label={
                  <span>
                    Base URL{" "}
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      (optional — leave empty to use default)
                    </Typography.Text>
                  </span>
                }
                style={{ marginBottom: spec.defaultModelEnv ? 8 : 0 }}
                help={
                  spec.baseUrlHint ? (
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {spec.baseUrlHint}
                    </Typography.Text>
                  ) : undefined
                }
              >
                <Input
                  value={f.baseUrl}
                  placeholder={spec.defaultBaseUrl}
                  onChange={(e) => updateProvider(spec.provider, { baseUrl: e.target.value })}
                />
              </Form.Item>
              {spec.defaultModelEnv && (
                <Form.Item label="Default model" style={{ marginBottom: 0 }}>
                  <Input
                    value={f.defaultModel}
                    placeholder="e.g. qwen3-max, glm-4-plus, …"
                    onChange={(e) =>
                      updateProvider(spec.provider, { defaultModel: e.target.value })
                    }
                  />
                </Form.Item>
              )}
            </Card>
          );
        })}

        <Divider style={{ margin: "16px 0" }} />

        <Form.Item label="Port">
          <InputNumber min={1} max={65535} value={port} onChange={(v) => setPort(v ?? 8788)} />
        </Form.Item>

        <Form.Item label="Data location">
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={dataDir}
              onChange={(e) => setDataDirField(e.target.value)}
              placeholder="Path where .env, runtime.json and the SQLite DB are stored"
            />
            <Button onClick={onBrowseDataDir}>Browse...</Button>
            <Button onClick={() => window.m2c.openPath(dataDir)}>Open</Button>
          </Space.Compact>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
            Your API keys are stored in plain text at <code>.env</code> inside this folder.
            Changing the path on Save will <strong>migrate existing files</strong> to the new location.
            Include this folder when filing a bug report (but redact the keys first).
          </Typography.Text>
        </Form.Item>

        <Form.Item>
          <Checkbox checked={autostart} onChange={(e) => setAutostartFlag(e.target.checked)}>
            Start on system boot
          </Checkbox>
        </Form.Item>
        <Form.Item>
          <Checkbox checked={showAdminAfter} onChange={(e) => setShowAdminAfter(e.target.checked)}>
            Show Admin UI on first launch
          </Checkbox>
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" onClick={onSave} disabled={!canSave}>
              Save & Restart
            </Button>
            <Button onClick={onCancel}>
              {state.isFirstRun ? "Quit" : "Cancel"}
            </Button>
            {!canSave && usableProviders === 0 && (
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                Fill at least one provider's API key.
              </Typography.Text>
            )}
          </Space>
        </Form.Item>
      </Form>
    </div>
  );
}
