import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  CrownOutlined,
  KeyOutlined,
  PlusOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { api, type UserWithUsage } from "../api/client";

const { Title, Paragraph } = Typography;

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000_000).toFixed(2)}M`;
}

export function UsersPage(): JSX.Element {
  const { t } = useTranslation("auth");
  const [rows, setRows] = useState<UserWithUsage[]>([]);
  const [allowRegister, setAllowRegister] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserWithUsage | null>(null);
  const [msg, msgCtx] = message.useMessage();

  async function refresh() {
    setLoading(true);
    try {
      const [u, p] = await Promise.all([api.listUsers(), api.getRegisterPolicy()]);
      setRows(u.users);
      setAllowRegister(p.allowRegister);
    } catch (err) {
      msg.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function setStatus(u: UserWithUsage, status: "active" | "disabled") {
    try {
      await api.patchUser(u.id, { status });
      msg.success(t("users.saved"));
      void refresh();
    } catch (err) {
      msg.error((err as Error).message);
    }
  }

  async function setAdmin(u: UserWithUsage, isAdmin: boolean) {
    try {
      await api.patchUser(u.id, { isAdmin });
      msg.success(t("users.saved"));
      void refresh();
    } catch (err) {
      msg.error((err as Error).message);
    }
  }

  async function toggleAllowRegister(v: boolean) {
    try {
      await api.setRegisterPolicy(v);
      setAllowRegister(v);
      msg.success(t("users.register.saved"));
    } catch (err) {
      msg.error((err as Error).message);
    }
  }

  const columns: ColumnsType<UserWithUsage> = [
    {
      title: t("users.table.username"),
      dataIndex: "username",
      key: "username",
      render: (v: string, row) => (
        <Space>
          <strong>{v}</strong>
          {row.is_admin && <CrownOutlined style={{ color: "#faad14" }} />}
        </Space>
      ),
    },
    {
      title: t("users.table.displayName"),
      dataIndex: "display_name",
      key: "display_name",
      render: (v: string | null) => v ?? <span style={{ opacity: 0.5 }}>—</span>,
    },
    {
      title: t("users.table.role"),
      dataIndex: "is_admin",
      key: "role",
      render: (v: boolean) =>
        v ? <Tag color="gold">{t("users.role.admin")}</Tag> : <Tag>{t("users.role.user")}</Tag>,
    },
    {
      title: t("users.table.status"),
      dataIndex: "status",
      key: "status",
      render: (v: string) =>
        v === "active" ? (
          <Tag icon={<CheckCircleTwoTone twoToneColor="#52c41a" />} color="success">
            {t("users.status.active")}
          </Tag>
        ) : (
          <Tag icon={<CloseCircleTwoTone twoToneColor="#cf1322" />} color="error">
            {t("users.status.disabled")}
          </Tag>
        ),
    },
    {
      title: t("users.table.requests"),
      dataIndex: "request_count",
      key: "request_count",
      align: "right",
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: t("users.table.totalTokens"),
      dataIndex: "total_tokens",
      key: "total_tokens",
      align: "right",
      render: (v: number) => formatTokens(v),
    },
    {
      title: t("users.table.lastActivity"),
      dataIndex: "last_activity",
      key: "last_activity",
      render: (v: number | null) =>
        v ? new Date(v).toLocaleString() : <span style={{ opacity: 0.5 }}>—</span>,
    },
    {
      title: t("users.table.created"),
      dataIndex: "created_at",
      key: "created_at",
      render: (v: number) => new Date(v).toLocaleString(),
    },
    {
      title: t("users.table.actions"),
      key: "actions",
      width: 320,
      render: (_v, row) => (
        <Space size={4} wrap>
          {row.status === "active" ? (
            <Popconfirm
              title={t("users.actions.disableConfirm", { username: row.username })}
              onConfirm={() => void setStatus(row, "disabled")}
            >
              <Button size="small" danger icon={<StopOutlined />}>
                {t("users.actions.disable")}
              </Button>
            </Popconfirm>
          ) : (
            <Popconfirm
              title={t("users.actions.enableConfirm", { username: row.username })}
              onConfirm={() => void setStatus(row, "active")}
            >
              <Button size="small">{t("users.actions.enable")}</Button>
            </Popconfirm>
          )}
          {row.is_admin ? (
            <Popconfirm
              title={t("users.actions.revokeAdminConfirm", { username: row.username })}
              onConfirm={() => void setAdmin(row, false)}
            >
              <Button size="small">{t("users.actions.revokeAdmin")}</Button>
            </Popconfirm>
          ) : (
            <Popconfirm
              title={t("users.actions.makeAdminConfirm", { username: row.username })}
              onConfirm={() => void setAdmin(row, true)}
            >
              <Button size="small" icon={<CrownOutlined />}>
                {t("users.actions.makeAdmin")}
              </Button>
            </Popconfirm>
          )}
          <Button size="small" icon={<KeyOutlined />} onClick={() => setResetTarget(row)}>
            {t("users.actions.resetPassword")}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {msgCtx}
      <Title level={3}>{t("users.title")}</Title>
      <Paragraph type="secondary">{t("users.description")}</Paragraph>

      <Card style={{ marginBottom: 16 }} title={t("users.register.title")} size="small">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text type="secondary">{t("users.register.description")}</Typography.Text>
          <Space>
            <Switch checked={allowRegister} onChange={(v) => void toggleAllowRegister(v)} />
            <Typography.Text>{t("users.register.switchLabel")}</Typography.Text>
          </Space>
        </Space>
      </Card>

      <div style={{ marginBottom: 12, textAlign: "right" }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          {t("users.create.title")}
        </Button>
      </div>
      <Table<UserWithUsage>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        pagination={false}
        size="small"
        loading={loading}
        scroll={{ x: 1200 }}
      />

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void refresh();
        }}
      />
      <ResetPasswordModal
        target={resetTarget}
        onClose={() => setResetTarget(null)}
        onDone={() => {
          setResetTarget(null);
          void refresh();
        }}
      />
    </div>
  );
}

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation("auth");
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [msg, msgCtx] = message.useMessage();

  async function onSubmit(values: {
    username: string;
    password: string;
    displayName?: string;
    isAdmin?: boolean;
  }) {
    setBusy(true);
    try {
      await api.createUserAdmin({
        username: values.username,
        password: values.password,
        displayName: values.displayName,
        isAdmin: !!values.isAdmin,
      });
      msg.success(t("users.create.success", { username: values.username }));
      form.resetFields();
      onCreated();
    } catch (err) {
      msg.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onCancel={onClose} footer={null} title={t("users.create.title")} destroyOnClose>
      {msgCtx}
      <Form layout="vertical" form={form} onFinish={onSubmit} disabled={busy}>
        <Form.Item label={t("users.create.username")} name="username" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item
          label={t("users.create.password")}
          name="password"
          rules={[{ required: true }, { min: 8 }]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item label={t("users.create.displayName")} name="displayName">
          <Input />
        </Form.Item>
        <Form.Item label={t("users.create.isAdmin")} name="isAdmin" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Button block type="primary" htmlType="submit" loading={busy}>
          {t("users.create.submit")}
        </Button>
      </Form>
    </Modal>
  );
}

function ResetPasswordModal({
  target,
  onClose,
  onDone,
}: {
  target: UserWithUsage | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation("auth");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, msgCtx] = message.useMessage();

  useEffect(() => {
    if (target) setPwd("");
  }, [target]);

  async function onSave() {
    if (!target) return;
    if (pwd.length < 8) {
      msg.error(t("users.actions.newPassword"));
      return;
    }
    setBusy(true);
    try {
      await api.patchUser(target.id, { password: pwd });
      msg.success(t("users.saved"));
      onDone();
    } catch (err) {
      msg.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!target}
      onCancel={onClose}
      onOk={() => void onSave()}
      okButtonProps={{ loading: busy, disabled: pwd.length < 8 }}
      title={target ? t("users.actions.resetPassword") + ` — ${target.username}` : ""}
      destroyOnClose
    >
      {msgCtx}
      <Form layout="vertical">
        <Form.Item label={t("users.actions.newPassword")}>
          <Input.Password
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder={t("users.actions.newPasswordPlaceholder")}
            autoFocus
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
