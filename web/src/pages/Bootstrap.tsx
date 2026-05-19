import { useState } from "react";
import { Alert, Button, Card, Form, Input, Layout, Space, Typography } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";

const { Title, Paragraph } = Typography;

export function BootstrapPage(): JSX.Element {
  const { t } = useTranslation("auth");
  const { refresh } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (values: {
    username: string;
    password: string;
    displayName?: string;
  }) => {
    setError(null);
    setLoading(true);
    try {
      await api.bootstrap({
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
      <Card style={{ width: 440, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div style={{ textAlign: "center" }}>
            <Title level={3} style={{ marginBottom: 4 }}>
              {t("bootstrap.title")}
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {t("bootstrap.subtitle")}
            </Paragraph>
          </div>
          {error && <Alert type="error" message={error} showIcon />}
          <Form layout="vertical" onFinish={onSubmit} disabled={loading} autoComplete="off">
            <Form.Item
              label={t("bootstrap.username")}
              name="username"
              rules={[{ required: true, message: t("bootstrap.usernameRequired") }]}
            >
              <Input prefix={<UserOutlined />} autoFocus />
            </Form.Item>
            <Form.Item label={t("bootstrap.displayName")} name="displayName">
              <Input placeholder={t("bootstrap.displayNamePlaceholder")} />
            </Form.Item>
            <Form.Item
              label={t("bootstrap.password")}
              name="password"
              rules={[
                { required: true, message: t("bootstrap.passwordRequired") },
                { min: 8, message: t("bootstrap.passwordTooShort") },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} />
            </Form.Item>
            <Button block type="primary" htmlType="submit" loading={loading}>
              {t("bootstrap.submit")}
            </Button>
          </Form>
        </Space>
      </Card>
    </Layout>
  );
}
