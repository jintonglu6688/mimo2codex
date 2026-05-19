import { useEffect, useState } from "react";
import { Alert, Button, Card, Divider, Form, Input, Layout, Space, Typography } from "antd";
import { GithubOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";

const { Title, Text } = Typography;

interface OAuthProviderEntry {
  provider: "github" | "gitee";
  callback_url: string;
}

export function LoginPage(): JSX.Element {
  const { t } = useTranslation("auth");
  const { login, allowRegister } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderEntry[]>([]);

  useEffect(() => {
    api
      .oauthPublicProviders()
      .then((r) => setOauthProviders(r.providers))
      .catch(() => {
        // OAuth is optional; if the endpoint errors just hide the buttons.
      });
  }, []);

  const onSubmit = async (values: { username: string; password: string }) => {
    setError(null);
    setLoading(true);
    try {
      await login(values.username, values.password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Card style={{ width: 380, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div style={{ textAlign: "center" }}>
            <Title level={3} style={{ marginBottom: 4 }}>
              mimo2codex
            </Title>
            <Text type="secondary">{t("login.tagline")}</Text>
          </div>
          {error && <Alert type="error" message={error} showIcon />}
          <Form layout="vertical" onFinish={onSubmit} disabled={loading} autoComplete="off">
            <Form.Item
              label={t("login.username")}
              name="username"
              rules={[{ required: true, message: t("login.usernameRequired") }]}
            >
              <Input prefix={<UserOutlined />} autoFocus />
            </Form.Item>
            <Form.Item
              label={t("login.password")}
              name="password"
              rules={[{ required: true, message: t("login.passwordRequired") }]}
            >
              <Input.Password prefix={<LockOutlined />} />
            </Form.Item>
            <Button block type="primary" htmlType="submit" loading={loading}>
              {t("login.submit")}
            </Button>
          </Form>
          {oauthProviders.length > 0 && (
            <>
              <Divider plain style={{ margin: "8px 0" }}>{t("login.orDivider")}</Divider>
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                {oauthProviders.map((p) => (
                  <Button
                    key={p.provider}
                    block
                    icon={p.provider === "github" ? <GithubOutlined /> : undefined}
                    onClick={() => {
                      window.location.href = `/oauth/login/${p.provider}`;
                    }}
                  >
                    {p.provider === "github" ? t("login.githubBtn") : t("login.giteeBtn")}
                  </Button>
                ))}
              </Space>
            </>
          )}
          {allowRegister && (
            <div style={{ textAlign: "center", fontSize: 13, opacity: 0.7 }}>
              {t("login.noAccount")}{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); window.location.href = "/admin/register"; }}>
                {t("login.signup")}
              </a>
            </div>
          )}
        </Space>
      </Card>
    </Layout>
  );
}
