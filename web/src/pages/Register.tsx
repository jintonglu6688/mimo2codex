import { useState } from "react";
import { Alert, Button, Card, Form, Input, Layout, Result, Space, Typography } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";

const { Title, Paragraph } = Typography;

export function RegisterPage(): JSX.Element {
  const { t } = useTranslation("auth");
  const { allowRegister, refresh } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!allowRegister) {
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
        <Card style={{ width: 420 }}>
          <Result
            status="info"
            title={t("register.title")}
            subTitle={t("register.disabledHint")}
            extra={
              <Button type="primary" onClick={() => (window.location.href = "/admin/login")}>
                {t("register.backToLogin")}
              </Button>
            }
          />
        </Card>
      </Layout>
    );
  }

  const onSubmit = async (values: { username: string; password: string; displayName?: string }) => {
    setError(null);
    setLoading(true);
    try {
      await api.register({
        username: values.username,
        password: values.password,
        displayName: values.displayName,
      });
      await refresh();
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
      <Card style={{ width: 420, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div style={{ textAlign: "center" }}>
            <Title level={3} style={{ marginBottom: 4 }}>
              {t("register.title")}
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {t("register.subtitleOpen")}
            </Paragraph>
          </div>
          {error && <Alert type="error" message={error} showIcon />}
          <Form layout="vertical" onFinish={onSubmit} disabled={loading} autoComplete="off">
            <Form.Item
              label={t("register.username")}
              name="username"
              rules={[{ required: true, message: t("register.usernameRequired") }]}
            >
              <Input prefix={<UserOutlined />} autoFocus />
            </Form.Item>
            <Form.Item label={t("register.displayName")} name="displayName">
              <Input placeholder={t("register.displayNamePlaceholder")} />
            </Form.Item>
            <Form.Item
              label={t("register.password")}
              name="password"
              rules={[
                { required: true, message: t("register.passwordRequired") },
                { min: 8, message: t("register.passwordTooShort") },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} />
            </Form.Item>
            <Button block type="primary" htmlType="submit" loading={loading}>
              {t("register.submit")}
            </Button>
          </Form>
          <div style={{ textAlign: "center" }}>
            <a href="#" onClick={(e) => { e.preventDefault(); window.location.href = "/admin/login"; }}>
              {t("register.backToLogin")}
            </a>
          </div>
        </Space>
      </Card>
    </Layout>
  );
}
