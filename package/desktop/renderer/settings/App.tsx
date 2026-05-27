import { useEffect, useState } from "react";
import { Form, Input, Select, InputNumber, Checkbox, Button, Space, Typography, Alert } from "antd";
import type { RuntimeConfig } from "../../shared/types.js";
import { PROVIDER_KEYS } from "../../shared/types.js";

interface LoadedState {
  runtime: RuntimeConfig;
  env: Record<string, string>;
  isFirstRun: boolean;
  userDataDir: string;
}

export function App() {
  const [state, setState] = useState<LoadedState | null>(null);
  const [provider, setProvider] = useState<"mimo" | "deepseek" | "generic">("mimo");
  const [apiKey, setApiKey] = useState("");
  const [port, setPort] = useState(8788);
  const [dataDir, setDataDirField] = useState("");
  const [autostart, setAutostartFlag] = useState(false);
  const [showAdminAfter, setShowAdminAfter] = useState(true);

  useEffect(() => {
    const off = window.m2c.on((msg) => {
      if (msg.type === "settings:loaded") {
        setState(msg.payload);
        setPort(msg.payload.runtime.port);
        setDataDirField(msg.payload.userDataDir);
        setAutostartFlag(msg.payload.runtime.autostart);
        // Pick first provider whose key already exists in env, default mimo
        const firstProvider = PROVIDER_KEYS.find(p => msg.payload.env[p.envKey]);
        if (firstProvider) {
          setProvider(firstProvider.provider);
          setApiKey(msg.payload.env[firstProvider.envKey]);
        }
      } else if (msg.type === "settings:dataDirChosen") {
        if (msg.payload.path) setDataDirField(msg.payload.path);
      }
    });
    window.m2c.send({ type: "settings:load" });
    return off;
  }, []);

  if (!state) return <div style={{ padding: 24 }}>Loading…</div>;

  const onSave = () => {
    const envKey = PROVIDER_KEYS.find(p => p.provider === provider)!.envKey;
    window.m2c.send({
      type: "settings:save",
      payload: {
        runtime: { ...state.runtime, port, autostart },
        env: { ...state.env, [envKey]: apiKey },
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

  const placeholderForProvider = provider === "mimo"
    ? "sk-xxxxxxxx (or tp-xxxxxxxx for token-plan)"
    : "sk-xxxxxxxx";

  const canSave = apiKey.trim().length > 0 && port > 0 && port < 65536 && dataDir.trim().length > 0;

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {state.isFirstRun ? "Welcome to mimo2codex" : "Settings"}
      </Typography.Title>
      {state.isFirstRun && (
        <Alert
          type="info"
          showIcon
          message="Set your provider API key to get started. You can add more providers later from the Admin UI."
          style={{ marginBottom: 16 }}
        />
      )}
      <Form layout="vertical">
        <Form.Item label="Provider">
          <Select value={provider} onChange={setProvider} options={[
            { value: "mimo", label: "MiMo (Xiaomi)" },
            { value: "deepseek", label: "DeepSeek" },
            { value: "generic", label: "Generic OpenAI-compatible" },
          ]} />
        </Form.Item>
        <Form.Item label="API Key">
          <Input.Password
            value={apiKey}
            placeholder={placeholderForProvider}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Form.Item>
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
            Your API key is stored in plain text at <code>.env</code> inside this folder.
            Changing the path on Save will <strong>migrate existing files</strong> to the new location.
            Include this folder when filing a bug report (but redact the key first).
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
          </Space>
        </Form.Item>
      </Form>
    </div>
  );
}
