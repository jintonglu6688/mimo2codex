import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CodeOutlined,
  ReloadOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import {
  api,
  type GenericProviderModelSpec,
  type GenericProviderSpec,
  type GenericProvidersResponse,
  type ProviderPresetClient,
} from "../api/client";

// Built-in provider ids — the user cannot create generics with these.
const RESERVED_IDS = new Set(["mimo", "deepseek"]);

interface FormValues extends GenericProviderSpec {
  wireApiDisplay: "chat" | "responses";
  forceParallelToolCalls: boolean;
  featWebSearch: boolean;
  // minimax-compat: 把 features 里的严格兼容子开关平铺到表单顶层，方便 antd Form 绑定。
  featMinimaxCompat: boolean;
  featDropNullStrict: boolean;
  featDropNullContent: boolean;
  featDropToolChoiceAuto: boolean;
  featDropStreamOptions: boolean;
  featDropParallelToolCalls: boolean;
  featMergeSystemMessages: boolean;
  featExtractThinkTags: boolean;
  featDropResponseFormat: boolean;
  featDropNonFunctionTools: boolean;
  // 单选 "" / "sensenova" / "minimax"。表单用 string 绑定，写回 spec 时 "" → 不写字段。
  featEnhanceErrorPreset: "" | "sensenova" | "minimax";
  // minimax-compat: 顶层 forceDefaultModel 是非 features 字段，单独平铺也是为了表单绑定方便。
  featForceDefaultModel: boolean;
}

function emptyFormValues(): FormValues {
  return {
    id: "",
    shortcut: "",
    displayName: "",
    baseUrl: "",
    envKey: "",
    defaultModel: "",
    wireApi: "chat",
    wireApiDisplay: "chat",
    models: [],
    features: { forceParallelToolCalls: false, webSearch: false },
    forceParallelToolCalls: false,
    featWebSearch: false,
    featMinimaxCompat: false,
    featDropNullStrict: false,
    featDropNullContent: false,
    featDropToolChoiceAuto: false,
    featDropStreamOptions: false,
    featDropParallelToolCalls: false,
    featMergeSystemMessages: false,
    featExtractThinkTags: false,
    featDropResponseFormat: false,
    featDropNonFunctionTools: false,
    featEnhanceErrorPreset: "",
    featForceDefaultModel: false,
    docsUrl: "",
  };
}

function specToFormValues(spec: GenericProviderSpec): FormValues {
  const wire = spec.wireApi ?? "chat";
  return {
    ...spec,
    shortcut: spec.shortcut ?? "",
    displayName: spec.displayName ?? "",
    wireApi: wire,
    wireApiDisplay: wire,
    models: spec.models ? spec.models.map((m) => ({ ...m })) : [],
    features: {
      forceParallelToolCalls: !!spec.features?.forceParallelToolCalls,
      webSearch: !!spec.features?.webSearch,
      // 平铺 minimax-compat 子开关
      minimaxCompat: !!spec.features?.minimaxCompat,
      dropNullStrict: !!spec.features?.dropNullStrict,
      dropNullContent: !!spec.features?.dropNullContent,
      dropToolChoiceAuto: !!spec.features?.dropToolChoiceAuto,
      dropStreamOptions: !!spec.features?.dropStreamOptions,
      dropParallelToolCalls: !!spec.features?.dropParallelToolCalls,
      mergeSystemMessages: !!spec.features?.mergeSystemMessages,
      extractThinkTags: !!spec.features?.extractThinkTags,
      dropResponseFormat: !!spec.features?.dropResponseFormat,
      dropNonFunctionTools: !!spec.features?.dropNonFunctionTools,
      enhanceErrorPreset: spec.features?.enhanceErrorPreset,
    },
    forceParallelToolCalls: !!spec.features?.forceParallelToolCalls,
    featWebSearch: !!spec.features?.webSearch,
    featMinimaxCompat: !!spec.features?.minimaxCompat,
    featDropNullStrict: !!spec.features?.dropNullStrict,
    featDropNullContent: !!spec.features?.dropNullContent,
    featDropToolChoiceAuto: !!spec.features?.dropToolChoiceAuto,
    featDropStreamOptions: !!spec.features?.dropStreamOptions,
    featDropParallelToolCalls: !!spec.features?.dropParallelToolCalls,
    featMergeSystemMessages: !!spec.features?.mergeSystemMessages,
    featExtractThinkTags: !!spec.features?.extractThinkTags,
    featDropResponseFormat: !!spec.features?.dropResponseFormat,
    featDropNonFunctionTools: !!spec.features?.dropNonFunctionTools,
    featEnhanceErrorPreset:
      spec.features?.enhanceErrorPreset === "sensenova" ||
      spec.features?.enhanceErrorPreset === "minimax"
        ? spec.features.enhanceErrorPreset
        : "",
    featForceDefaultModel: !!spec.forceDefaultModel,
    docsUrl: spec.docsUrl ?? "",
  };
}

function formValuesToSpec(form: FormValues): GenericProviderSpec {
  const out: GenericProviderSpec = {
    id: form.id.trim(),
    baseUrl: form.baseUrl.trim(),
    envKey: form.envKey.trim(),
    defaultModel: form.defaultModel.trim(),
  };
  if (form.shortcut?.trim()) out.shortcut = form.shortcut.trim();
  if (form.displayName?.trim()) out.displayName = form.displayName.trim();
  if (form.wireApiDisplay === "responses") out.wireApi = "responses";
  const models = (form.models ?? [])
    .map((m) => ({ ...m, id: (m.id ?? "").trim() }))
    .filter((m) => m.id);
  if (models.length > 0) out.models = models;
  // features 同时承载 boolean 子开关与 string 字段（enhanceErrorPreset），用 union 类型。
  const features: Record<string, boolean | string> = {};
  if (form.forceParallelToolCalls) features.forceParallelToolCalls = true;
  if (form.featWebSearch) features.webSearch = true;
  // minimax-compat: 6 个子开关 + 1 个一键预设。开关默认 false → 写入时只在 true 时落盘
  // 以保持 providers.json 清爽，与既有 forceParallelToolCalls / webSearch 处理一致。
  if (form.featMinimaxCompat) features.minimaxCompat = true;
  if (form.featDropNullStrict) features.dropNullStrict = true;
  if (form.featDropNullContent) features.dropNullContent = true;
  if (form.featDropToolChoiceAuto) features.dropToolChoiceAuto = true;
  if (form.featDropStreamOptions) features.dropStreamOptions = true;
  if (form.featDropParallelToolCalls) features.dropParallelToolCalls = true;
  if (form.featMergeSystemMessages) features.mergeSystemMessages = true;
  if (form.featExtractThinkTags) features.extractThinkTags = true;
  if (form.featDropResponseFormat) features.dropResponseFormat = true;
  if (form.featDropNonFunctionTools) features.dropNonFunctionTools = true;
  if (form.featEnhanceErrorPreset) features.enhanceErrorPreset = form.featEnhanceErrorPreset;
  if (Object.keys(features).length > 0) {
    // GenericProviderSpec.features 期望具体字段类型，运行时这里就是匹配的，断言收口。
    out.features = features as GenericProviderSpec["features"];
  }
  // minimax-compat: 顶层 forceDefaultModel
  if (form.featForceDefaultModel) out.forceDefaultModel = true;
  if (form.docsUrl?.trim()) out.docsUrl = form.docsUrl.trim();
  return out;
}

export function Providers() {
  const { t } = useTranslation("providers");
  const [messageApi, msgCtx] = message.useMessage();
  const [modal, modalCtx] = Modal.useModal();
  const [data, setData] = useState<GenericProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    | { mode: "create"; values: FormValues }
    | { mode: "edit"; originalId: string; values: FormValues }
    | null
  >(null);
  const [rawEditor, setRawEditor] = useState<string | null>(null);
  // 已知厂商预设，仅用于在 ProviderFormModal 里做"输入命中即自动套用 features"。
  // 加载失败不阻塞页面 —— 预设缺失只是失去自动化便利，手动配置仍可用。
  const [presets, setPresets] = useState<ProviderPresetClient[]>([]);

  async function load() {
    try {
      setError(null);
      const resp = await api.genericProviders();
      setData(resp);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    api
      .providerPresets()
      .then((r) => setPresets(r.presets))
      .catch(() => {/* 静默 */});
  }, []);

  async function save(updated: GenericProviderSpec[]) {
    try {
      setError(null);
      setSuccess(null);
      const resp = await api.saveGenericProviders(updated);
      const key = resp.restartRequired ? "saved.withRestart" : "saved.withoutRestart";
      const text = t(key, { path: resp.path });
      setSuccess(text);
      messageApi.success(text);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startCreate() {
    setEditing({ mode: "create", values: emptyFormValues() });
  }
  function startEdit(spec: GenericProviderSpec) {
    setEditing({
      mode: "edit",
      originalId: spec.id,
      values: specToFormValues(spec),
    });
  }

  async function remove(id: string) {
    if (!data) return;
    modal.confirm({
      title: t("deleteConfirm", { id }),
      icon: <DeleteOutlined />,
      okButtonProps: { danger: true },
      onOk: async () => {
        await save(data.specs.filter((s) => s.id !== id));
      },
    });
  }

  async function commitForm(values: FormValues) {
    if (!editing || !data) return;
    const id = values.id.trim();
    if (!id) {
      setError(t("form.validate.idRequired"));
      return;
    }
    if (RESERVED_IDS.has(id)) {
      setError(t("form.validate.idReserved", { id }));
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
      setError(t("form.validate.idFormat", { id }));
      return;
    }
    const originalId = editing.mode === "edit" ? editing.originalId : null;
    if (data.specs.some((s) => s.id === id && s.id !== originalId)) {
      setError(t("form.validate.idDup", { id }));
      return;
    }
    if (!values.baseUrl.trim()) {
      setError(t("form.validate.baseUrlRequired"));
      return;
    }
    if (!values.envKey.trim()) {
      setError(t("form.validate.envKeyRequired"));
      return;
    }
    if (!values.defaultModel.trim()) {
      setError(t("form.validate.defaultModelRequired"));
      return;
    }
    const next = formValuesToSpec(values);
    const merged =
      editing.mode === "create"
        ? [...data.specs, next]
        : data.specs.map((s) => (s.id === editing.originalId ? next : s));
    setEditing(null);
    await save(merged);
  }

  async function commitRawJson() {
    if (rawEditor == null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawEditor);
    } catch (err) {
      setError(t("rawJson.parseError", { message: (err as Error).message }));
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      setError(t("rawJson.notObject"));
      return;
    }
    const obj = parsed as { providers?: unknown };
    if (!Array.isArray(obj.providers)) {
      setError(t("rawJson.missingProviders"));
      return;
    }
    setRawEditor(null);
    await save(obj.providers as GenericProviderSpec[]);
  }

  const columns: ColumnsType<GenericProviderSpec> = useMemo(
    () => [
      {
        title: t("table.columns.id"),
        dataIndex: "id",
        key: "id",
        render: (id: string, row) => (
          <Space>
            <strong>
              <code>{id}</code>
            </strong>
            {row.shortcut && row.shortcut !== row.id && (
              <Tag>{t("table.shortcutTag", { value: row.shortcut })}</Tag>
            )}
          </Space>
        ),
      },
      {
        title: t("table.columns.displayName"),
        key: "displayName",
        render: (_, row) => row.displayName ?? row.id,
      },
      {
        title: t("table.columns.baseUrl"),
        dataIndex: "baseUrl",
        key: "baseUrl",
        render: (v: string) => <code style={{ fontSize: 11 }}>{v}</code>,
      },
      {
        title: t("table.columns.defaultModel"),
        dataIndex: "defaultModel",
        key: "defaultModel",
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: t("table.columns.wireApi"),
        dataIndex: "wireApi",
        key: "wireApi",
        render: (v: GenericProviderSpec["wireApi"]) => (
          <Tag color={v === "responses" ? "success" : "default"}>{v ?? "chat"}</Tag>
        ),
      },
      {
        title: t("table.columns.models"),
        key: "models",
        render: (_, row) =>
          row.models && row.models.length > 0 ? (
            <Tag>{t("table.modelCountTag", { count: row.models.length })}</Tag>
          ) : (
            <Tag>{t("table.passthroughTag")}</Tag>
          ),
      },
      {
        title: t("table.columns.ops"),
        key: "ops",
        align: "right",
        width: 200,
        render: (_, row) => (
          <Space>
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => startEdit(row)}
              disabled={!data?.editable}
            >
              {t("action.edit")}
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => void remove(row.id)}
              disabled={!data?.editable}
            >
              {t("action.delete")}
            </Button>
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, data?.editable]
  );

  return (
    <>
      {msgCtx}
      {modalCtx}
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        {t("title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        <Trans i18nKey="intro" ns="providers">
          {"placeholder"}
          <a
            href="https://github.com/7as0nch/mimo2codex/blob/main/doc/generic-providers.zh.md"
            target="_blank"
            rel="noreferrer"
          >
            placeholder
          </a>
          {"placeholder"}
        </Trans>
      </Typography.Paragraph>

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}
      {success && (
        <Alert
          type="warning"
          showIcon
          message={success}
          closable
          onClose={() => setSuccess(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {data && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              <Space wrap>
                <strong>{t("file.title")}:</strong>
                <code>{data.path ?? "(unavailable)"}</code>
                {data.source === "explicit" && <Tag>{t("file.explicit")}</Tag>}
                {!data.exists && data.path && (
                  <Tag color="warning">{t("file.notCreated")}</Tag>
                )}
                {!data.editable && (
                  <Tag color="error">
                    {t("file.notEditable", { notice: data.notice ?? "" })}
                  </Tag>
                )}
              </Space>
            }
            description={
              data.error ? (
                <div style={{ marginTop: 8 }}>
                  {t("file.currentError", { error: data.error })}
                </div>
              ) : undefined
            }
          />

          <Card>
            <Space style={{ marginBottom: 16 }}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={startCreate}
                disabled={!data.editable}
              >
                {t("action.create")}
              </Button>
              <Button
                icon={<CodeOutlined />}
                onClick={() =>
                  setRawEditor(JSON.stringify({ providers: data.specs }, null, 2))
                }
                disabled={!data.editable}
              >
                {t("action.rawJson")}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void load()}>
                {t("action.refresh")}
              </Button>
            </Space>

            <Table<GenericProviderSpec>
              rowKey="id"
              dataSource={data.specs}
              columns={columns}
              pagination={false}
              size="middle"
              locale={{ emptyText: t("table.empty") }}
            />
          </Card>
        </>
      )}

      {editing && (
        <ProviderFormModal
          mode={editing.mode}
          initialValues={editing.values}
          presets={presets}
          onCancel={() => setEditing(null)}
          onSubmit={commitForm}
        />
      )}

      {rawEditor != null && (
        <RawJsonModal
          value={rawEditor}
          setValue={setRawEditor}
          onCancel={() => setRawEditor(null)}
          onSubmit={() => void commitRawJson()}
        />
      )}
    </>
  );
}

// 列出所有 feature 复选框字段 —— watcher 用它判断"用户是否已勾过任何 feature"
// （已勾过则不自动覆盖），以及 clearAutoApplied 用它一次性还原。
const FEATURE_BOOLEAN_KEYS: Array<keyof FormValues> = [
  "forceParallelToolCalls",
  "featWebSearch",
  "featMinimaxCompat",
  "featDropNullStrict",
  "featDropNullContent",
  "featDropToolChoiceAuto",
  "featDropStreamOptions",
  "featDropParallelToolCalls",
  "featMergeSystemMessages",
  "featExtractThinkTags",
  "featDropResponseFormat",
  "featDropNonFunctionTools",
  "featForceDefaultModel",
];

// 只看 sanitizer boolean 开关 —— enhanceErrorPreset 是"分类标签"而非 sanitizer，
// 排除它，否则用户主动从单选切到 sensenova/minimax 时这里就 true 了，下面的
// preset watcher 永远套不上 features。
function hasUserCustomizedFeatures(v: Partial<FormValues>): boolean {
  for (const k of FEATURE_BOOLEAN_KEYS) {
    if (v[k]) return true;
  }
  return false;
}

// 把 preset.recommendedSpec.features (后端字段命名) 映射成 FormValues 里的 feat* 平铺字段。
function mapPresetFeaturesToFormFlags(
  features: Record<string, boolean | string>,
): Partial<FormValues> {
  const patch: Partial<FormValues> = {};
  if (typeof features.forceParallelToolCalls === "boolean")
    patch.forceParallelToolCalls = features.forceParallelToolCalls;
  if (typeof features.webSearch === "boolean") patch.featWebSearch = features.webSearch;
  if (typeof features.minimaxCompat === "boolean") patch.featMinimaxCompat = features.minimaxCompat;
  if (typeof features.dropNullStrict === "boolean") patch.featDropNullStrict = features.dropNullStrict;
  if (typeof features.dropNullContent === "boolean") patch.featDropNullContent = features.dropNullContent;
  if (typeof features.dropToolChoiceAuto === "boolean")
    patch.featDropToolChoiceAuto = features.dropToolChoiceAuto;
  if (typeof features.dropStreamOptions === "boolean")
    patch.featDropStreamOptions = features.dropStreamOptions;
  if (typeof features.dropParallelToolCalls === "boolean")
    patch.featDropParallelToolCalls = features.dropParallelToolCalls;
  if (typeof features.mergeSystemMessages === "boolean")
    patch.featMergeSystemMessages = features.mergeSystemMessages;
  if (typeof features.extractThinkTags === "boolean")
    patch.featExtractThinkTags = features.extractThinkTags;
  if (typeof features.dropResponseFormat === "boolean")
    patch.featDropResponseFormat = features.dropResponseFormat;
  if (typeof features.dropNonFunctionTools === "boolean")
    patch.featDropNonFunctionTools = features.dropNonFunctionTools;
  if (features.enhanceErrorPreset === "sensenova" || features.enhanceErrorPreset === "minimax") {
    patch.featEnhanceErrorPreset = features.enhanceErrorPreset;
  }
  return patch;
}

function matchPresetClient(
  presets: readonly ProviderPresetClient[],
  baseUrl: string,
  model: string,
): ProviderPresetClient | null {
  const bu = (baseUrl || "").toLowerCase();
  const m = (model || "").toLowerCase();
  for (const p of presets) {
    if (p.matchBaseUrl.some((s) => bu.includes(s.toLowerCase()))) return p;
  }
  for (const p of presets) {
    if (p.matchModelPrefix.some((s) => m.startsWith(s.toLowerCase()))) return p;
  }
  return null;
}

function ProviderFormModal({
  mode,
  initialValues,
  presets,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  initialValues: FormValues;
  presets: ProviderPresetClient[];
  onCancel: () => void;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const { t } = useTranslation("providers");
  const { t: tCommon } = useTranslation("common");
  const [form] = Form.useForm<FormValues>();
  // autoApplied: 显示哪个预设刚被自动套用（null 表示未套用 / 已清除）。
  const [autoApplied, setAutoApplied] = useState<string | null>(null);

  // Radio 当前值用 React useState 控制 —— 不用 Form.useWatch，因为脱离 Form.Item 的字段，
  // setFieldsValue 写入后 useWatch 在 rc-field-form 内部不一定能感知到（之前症状："切到
  // sensenova 后 features checkbox 套上了但 Radio 一直 none 高亮"，正是这个原因）。
  // useState 是 React 自己的 setter，写完立刻在下次 render 生效，没有内部状态机干扰。
  // form store 仍通过 setFieldsValue 同步，submit 路径走 hidden Form.Item 让 validateFields
  // 能拿到该字段，与既有 formValuesToSpec 接口保持兼容。
  const [presetRadioValue, setPresetRadioValue] = useState<"" | "sensenova" | "minimax">(
    (initialValues.featEnhanceErrorPreset ?? "") as "" | "sensenova" | "minimax",
  );
  // "高级（细粒度兼容子开关）"折叠状态。自动跟随预设：none → 展开，预设 → 折叠；
  // 用户也可手动展开/收起；切换预设时强制同步（覆盖手动 state，因为切预设是清零信号）。
  const [advancedExpanded, setAdvancedExpanded] = useState<boolean>(
    presetRadioValue === "",
  );
  useEffect(() => {
    setAdvancedExpanded(presetRadioValue === "");
  }, [presetRadioValue]);

  // Watcher A：监听 baseUrl / defaultModel，命中已知厂商预设 + 当前 features 全空 → 自动套用。
  // create 与 edit 都触发：用户偏好"帮老配置跟上推荐"。hasUserCustomizedFeatures 保护，
  // 已经勾过任何 feature 的存量配置不会被覆盖。
  const watchedBaseUrl = Form.useWatch("baseUrl", form);
  const watchedModel = Form.useWatch("defaultModel", form);
  useEffect(() => {
    if (!presets.length) return;
    const preset = matchPresetClient(presets, watchedBaseUrl ?? "", watchedModel ?? "");
    if (!preset) {
      // 改成不命中的值 → 只清 Alert，不还原已套字段（避免抖动；用户可点 Alert 上的清除按钮）。
      setAutoApplied(null);
      return;
    }
    const current = form.getFieldsValue();
    if (hasUserCustomizedFeatures(current)) return;
    form.setFieldsValue(mapPresetFeaturesToFormFlags(preset.recommendedSpec.features));
    setAutoApplied(preset.displayName);
    // 同步给 Radio 的 useState（form.setFieldsValue 写 store 但 Radio value 来自 useState）
    const presetId = preset.recommendedSpec.features.enhanceErrorPreset;
    if (presetId === "sensenova" || presetId === "minimax") {
      setPresetRadioValue(presetId);
    }
  }, [watchedBaseUrl, watchedModel, presets, form]);

  // Radio onChange：useState 主管 UI，setFieldsValue 同步 form store
  function onPresetRadioChange(newVal: string): void {
    const v: "" | "sensenova" | "minimax" =
      newVal === "sensenova" || newVal === "minimax" ? newVal : "";
    // 1. 立即更新 useState（Radio 高亮立刻切换，无中间态）
    setPresetRadioValue(v);
    // 2. 同步 form store（hidden Form.Item 让 validateFields 也能拿到）
    form.setFieldsValue({ featEnhanceErrorPreset: v });

    if (v === "") {
      setAutoApplied(null);
      return;
    }
    const preset = presets.find((p) => p.id === v);
    if (!preset) {
      setAutoApplied(null);
      return;
    }

    // 3. 清"预设管理范围"内字段，防止 sensenova → minimax 残留 sensenova 的勾。
    // preset 范围 = 所有已知 preset 的 patch 字段并集；不影响 preset 范围外字段
    // (forceParallelToolCalls / featForceDefaultModel 等用户独立配置)。
    const presetManagedKeys = new Set<keyof FormValues>();
    for (const p of presets) {
      const flat = mapPresetFeaturesToFormFlags(p.recommendedSpec.features);
      for (const k of Object.keys(flat) as Array<keyof FormValues>) {
        if (k === "featEnhanceErrorPreset") continue;
        presetManagedKeys.add(k);
      }
    }
    const reset: Partial<FormValues> = {};
    for (const k of presetManagedKeys) {
      (reset as Record<string, unknown>)[k] = false;
    }

    // 4. 套新 preset。触发源字段不回写 —— 第 2 步已经写好。
    const patch = mapPresetFeaturesToFormFlags(preset.recommendedSpec.features);
    delete patch.featEnhanceErrorPreset;
    form.setFieldsValue({ ...reset, ...patch });
    setAutoApplied(preset.displayName);
  }

  function clearAutoApplied(): void {
    const reset: Partial<FormValues> = { featEnhanceErrorPreset: "" };
    for (const k of FEATURE_BOOLEAN_KEYS) {
      (reset as Record<string, unknown>)[k] = false;
    }
    form.setFieldsValue(reset);
    setPresetRadioValue(""); // Radio 的 useState 也要同步还原
    setAutoApplied(null);
  }

  const title =
    mode === "create"
      ? t("form.titleCreate")
      : t("form.titleEdit", { name: initialValues.id || "Provider" });

  return (
    <Modal
      open
      width={760}
      title={title}
      onCancel={onCancel}
      okText={tCommon("save")}
      cancelText={tCommon("cancel")}
      onOk={async () => {
        const values = await form.validateFields();
        await onSubmit(values);
      }}
      destroyOnClose
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={initialValues}
        preserve={false}
      >
        <Form.Item
          name="id"
          label={t("form.fields.id")}
          rules={[{ required: true, message: t("form.validate.idRequired") }]}
          extra={t("form.fields.idHint")}
        >
          <Input
            placeholder={t("form.fields.idPlaceholder")}
            disabled={mode === "edit"}
          />
        </Form.Item>

        <Form.Item name="displayName" label={t("form.fields.displayName")}>
          <Input placeholder={t("form.fields.displayNamePlaceholder")} />
        </Form.Item>

        <Form.Item
          name="shortcut"
          label={t("form.fields.shortcut")}
          extra={t("form.fields.shortcutHint")}
        >
          <Input placeholder={t("form.fields.shortcutPlaceholder")} />
        </Form.Item>

        <Form.Item
          name="baseUrl"
          label={t("form.fields.baseUrl")}
          rules={[
            { required: true, message: t("form.validate.baseUrlRequired") },
          ]}
          extra={
            <Trans i18nKey="form.fields.baseUrlHint" ns="providers">
              {"placeholder"}
            </Trans>
          }
        >
          <Input placeholder={t("form.fields.baseUrlPlaceholder")} />
        </Form.Item>

        <Form.Item
          name="envKey"
          label={t("form.fields.envKey")}
          rules={[
            { required: true, message: t("form.validate.envKeyRequired") },
          ]}
          extra={t("form.fields.envKeyHint")}
        >
          <Input placeholder={t("form.fields.envKeyPlaceholder")} />
        </Form.Item>

        <Form.Item
          name="defaultModel"
          label={t("form.fields.defaultModel")}
          rules={[
            {
              required: true,
              message: t("form.validate.defaultModelRequired"),
            },
          ]}
        >
          <Input placeholder={t("form.fields.defaultModelPlaceholder")} />
        </Form.Item>

        <Form.Item name="wireApiDisplay" label={t("form.fields.wireApi")}>
          <Radio.Group>
            <Radio.Button value="chat">
              <Space direction="vertical" size={0} style={{ alignItems: "flex-start" }}>
                <strong>{t("form.fields.wireApiChat")}</strong>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {t("form.fields.wireApiChatSub")}
                </Typography.Text>
              </Space>
            </Radio.Button>
            <Radio.Button value="responses">
              <Space direction="vertical" size={0} style={{ alignItems: "flex-start" }}>
                <strong>{t("form.fields.wireApiResponses")}</strong>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {t("form.fields.wireApiResponsesSub")}
                </Typography.Text>
              </Space>
            </Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item label={t("form.fields.features")}>
          <Space direction="vertical">
            <Form.Item
              name="forceParallelToolCalls"
              valuePropName="checked"
              noStyle
            >
              <Checkbox>
                <strong>{t("form.fields.forceParallelToolCalls")}</strong>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.forceParallelToolCallsSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
            <Form.Item name="featWebSearch" valuePropName="checked" noStyle>
              <Checkbox>
                <strong>{t("form.fields.webSearch")}</strong>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.webSearchSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
          </Space>
        </Form.Item>

        {/* 厂商快捷预设：放在最上面。选 sensenova / minimax 会做两件事 ——
            ① 一键勾上下面"高级"区里的推荐细粒度子开关
            ② 上游模糊化 400 翻译成诊断 hint */}
        <Form.Item label={t("form.fields.enhanceErrorPresetTitle")}>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            {t("form.fields.enhanceErrorPresetSub")}
          </Typography.Paragraph>
          {autoApplied && (
            <Alert
              type="success"
              showIcon
              closable
              onClose={() => setAutoApplied(null)}
              message={t("form.fields.presetAutoApplied", { name: autoApplied })}
              action={
                <Button size="small" onClick={clearAutoApplied}>
                  {t("form.fields.presetClear")}
                </Button>
              }
              style={{ marginBottom: 12 }}
            />
          )}
          {/* Radio value 由 React useState 控制（presetRadioValue），不耦合 antd 内部
              状态机。hidden Form.Item 仅用于让 validateFields 能拿到该字段以走通既有
              formValuesToSpec 路径。onChange 里 setFieldsValue + setPresetRadioValue
              双写保证两边同步。 */}
          <Form.Item name="featEnhanceErrorPreset" noStyle hidden>
            <input type="hidden" />
          </Form.Item>
          <Radio.Group
            size="small"
            value={presetRadioValue}
            onChange={(e) => onPresetRadioChange(e.target.value as string)}
          >
            <Radio.Button value="">{t("form.fields.enhanceErrorPresetNone")}</Radio.Button>
            <Radio.Button value="sensenova">sensenova</Radio.Button>
            <Radio.Button value="minimax">minimax</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {/* 高级：严格 OpenAI 兼容（细粒度子开关）。折叠默认状态自动跟随预设：选预设折
            叠（推荐已套用，不必看）；选 none 展开。用户也可手动点 header 切换。 */}
        <Collapse
          ghost
          activeKey={advancedExpanded ? ["advanced"] : []}
          onChange={(keys) =>
            setAdvancedExpanded(Array.isArray(keys) ? keys.length > 0 : !!keys)
          }
          items={[
            {
              key: "advanced",
              label: (
                <strong style={{ fontSize: 13 }}>
                  {t("form.fields.strictCompat")}
                </strong>
              ),
              children: (
                <>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                    {t("form.fields.strictCompatHint")}
                  </Typography.Paragraph>
                  <Space direction="vertical">
                    <Form.Item name="featMinimaxCompat" valuePropName="checked" noStyle>
                      <Checkbox>
                        <strong>{t("form.fields.minimaxCompat")}</strong>{" "}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          · {t("form.fields.minimaxCompatSub")}
                        </Typography.Text>
                      </Checkbox>
                    </Form.Item>
                    <Form.Item name="featForceDefaultModel" valuePropName="checked" noStyle>
                      <Checkbox>
                        <strong>{t("form.fields.forceDefaultModel")}</strong>{" "}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          · {t("form.fields.forceDefaultModelSub")}
                        </Typography.Text>
                      </Checkbox>
                    </Form.Item>

                    <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 4 }}>
                      {t("form.fields.strictCompatSubswitches")}
                    </Typography.Text>
                    <Form.Item name="featDropNullStrict" valuePropName="checked" noStyle>
                      <Checkbox>
                        <code>dropNullStrict</code>{" "}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          · {t("form.fields.dropNullStrictSub")}
                        </Typography.Text>
                      </Checkbox>
                    </Form.Item>
                    <Form.Item name="featDropNullContent" valuePropName="checked" noStyle>
                      <Checkbox>
                        <code>dropNullContent</code>{" "}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          · {t("form.fields.dropNullContentSub")}
                        </Typography.Text>
                      </Checkbox>
                    </Form.Item>
                    <Form.Item name="featDropToolChoiceAuto" valuePropName="checked" noStyle>
                      <Checkbox>
                        <code>dropToolChoiceAuto</code>{" "}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          · {t("form.fields.dropToolChoiceAutoSub")}
                        </Typography.Text>
                      </Checkbox>
                    </Form.Item>
                    <Form.Item name="featDropStreamOptions" valuePropName="checked" noStyle>
                      <Checkbox>
                        <code>dropStreamOptions</code>{" "}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          · {t("form.fields.dropStreamOptionsSub")}
                        </Typography.Text>
                      </Checkbox>
                    </Form.Item>
                    <Form.Item name="featDropParallelToolCalls" valuePropName="checked" noStyle>
                      <Checkbox>
                        <code>dropParallelToolCalls</code>{" "}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          · {t("form.fields.dropParallelToolCallsSub")}
                        </Typography.Text>
                      </Checkbox>
                    </Form.Item>
                    <Form.Item name="featMergeSystemMessages" valuePropName="checked" noStyle>
                      <Checkbox>
                        <code>mergeSystemMessages</code>{" "}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          · {t("form.fields.mergeSystemMessagesSub")}
                        </Typography.Text>
                      </Checkbox>
                    </Form.Item>
                    <Form.Item name="featExtractThinkTags" valuePropName="checked" noStyle>
                      <Checkbox>
                        <code>extractThinkTags</code>{" "}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          · {t("form.fields.extractThinkTagsSub")}
                        </Typography.Text>
                      </Checkbox>
                    </Form.Item>
                    <Form.Item name="featDropResponseFormat" valuePropName="checked" noStyle>
                      <Checkbox>
                        <code>dropResponseFormat</code>{" "}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          · {t("form.fields.dropResponseFormatSub")}
                        </Typography.Text>
                      </Checkbox>
                    </Form.Item>
                    <Form.Item name="featDropNonFunctionTools" valuePropName="checked" noStyle>
                      <Checkbox>
                        <code>dropNonFunctionTools</code>{" "}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          · {t("form.fields.dropNonFunctionToolsSub")}
                        </Typography.Text>
                      </Checkbox>
                    </Form.Item>
                  </Space>
                </>
              ),
            },
          ]}
        />

        <Form.Item
          name="docsUrl"
          label={t("form.fields.docsUrl")}
          extra={t("form.fields.docsUrlHint")}
        >
          <Input placeholder="https://..." />
        </Form.Item>

        <Typography.Title level={5}>{t("form.models.title")}</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          <Trans i18nKey="form.models.hint" ns="providers">
            {"placeholder"}
          </Trans>
        </Typography.Paragraph>

        <Form.List name="models">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Card
                  key={field.key}
                  size="small"
                  style={{ marginBottom: 12 }}
                  styles={{ body: { padding: 12 } }}
                  extra={
                    <Button
                      type="text"
                      danger
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  }
                >
                  <Form.Item
                    {...field}
                    label="model id"
                    name={[field.name, "id"]}
                    rules={[{ required: true }]}
                    style={{ marginBottom: 8 }}
                  >
                    <Input placeholder={t("form.models.idPlaceholder")} />
                  </Form.Item>
                  <Space wrap>
                    <Form.Item
                      name={[field.name, "contextWindow"]}
                      label={t("form.models.contextPlaceholder")}
                      style={{ marginBottom: 8 }}
                    >
                      <InputNumber min={1} placeholder="262144" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "maxOutputTokens"]}
                      label={t("form.models.maxOutputPlaceholder")}
                      style={{ marginBottom: 8 }}
                    >
                      <InputNumber min={1} placeholder="8192" />
                    </Form.Item>
                  </Space>
                  <Space>
                    <Form.Item
                      name={[field.name, "supportsImages"]}
                      valuePropName="checked"
                      noStyle
                    >
                      <Checkbox>{t("form.models.vision")}</Checkbox>
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "supportsReasoning"]}
                      valuePropName="checked"
                      noStyle
                    >
                      <Checkbox>{t("form.models.reasoning")}</Checkbox>
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "supportsWebSearch"]}
                      valuePropName="checked"
                      noStyle
                    >
                      <Checkbox>{t("form.models.webSearch")}</Checkbox>
                    </Form.Item>
                  </Space>
                </Card>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() =>
                  add({ id: "" } as Partial<GenericProviderModelSpec>)
                }
                block
              >
                {t("form.models.addBtn")}
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}

function RawJsonModal({
  value,
  setValue,
  onCancel,
  onSubmit,
}: {
  value: string;
  setValue: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation("providers");
  const { t: tCommon } = useTranslation("common");

  const valid = useMemo(() => {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }, [value]);

  return (
    <Modal
      open
      width={760}
      title={t("rawJson.title")}
      onCancel={onCancel}
      onOk={onSubmit}
      okText={tCommon("save")}
      cancelText={tCommon("cancel")}
      okButtonProps={{ disabled: !valid }}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
        {t("rawJson.hint")}
      </Typography.Paragraph>
      <Input.TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={20}
        status={valid ? "" : "error"}
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      />
      <Typography.Text
        type={valid ? "success" : "danger"}
        style={{ fontSize: 11, marginTop: 6, display: "block" }}
      >
        {valid ? t("rawJson.valid") : t("rawJson.invalid")}
      </Typography.Text>
    </Modal>
  );
}
