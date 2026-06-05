import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Grid, Modal, Popover, Tag, Typography } from "antd";
import { DashboardOutlined } from "@ant-design/icons";
import { api, type CodexDirInfo, type CodexState } from "../api/client";
import { CurrentStateCard } from "../pages/codex/CurrentStateCard";
import { cleanWinPath, middleEllipsis } from "../utils/text";

// Live "current Codex state" chip in the header. Labeled 当前状态, it cycles
// (ticker-style) through each state row — codex dir, auth.json owner,
// config.toml provider/model, runtime override — one at a time, so it stays
// compact among the other header controls. Click opens the full editable card
// (popover on wide screens, modal when narrow).

const POLL_MS = 30_000;
const ROTATE_MS = 3_000;

function sniffToml(text: string | null): { model: string | null; provider: string | null } {
  if (!text) return { model: null, provider: null };
  return {
    model: /^\s*model\s*=\s*"([^"\n]+)"/m.exec(text)?.[1] ?? null,
    provider: /^\s*model_provider\s*=\s*"([^"\n]+)"/m.exec(text)?.[1] ?? null,
  };
}

export function CodexStatusHeader() {
  const { t } = useTranslation("codexEnable");
  const [state, setState] = useState<CodexState | null>(null);
  const [dirInfo, setDirInfo] = useState<CodexDirInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const screens = Grid.useBreakpoint();
  const narrow = !screens.md; // icon-only + modal

  async function load() {
    try {
      const [s, d] = await Promise.all([
        api.codexState(),
        api.codexDir().catch(() => null),
      ]);
      setState(s);
      setDirInfo(d);
    } catch {
      /* keep last-known state — header must never throw */
    }
  }

  useEffect(() => {
    void load();
    const tid = setInterval(load, POLL_MS);
    return () => clearInterval(tid);
  }, []);

  // The rotating items, mirroring the rows of the full state card.
  const items = useMemo(() => {
    if (!state) return [] as { label: string; value: string; color?: string }[];
    const toml = sniffToml(state.configTomlText);
    const ownerLabel = t(`state.owner.${state.authJsonOwner}`);
    const ownerColor =
      state.authJsonOwner === "mimo2codex"
        ? "success"
        : state.authJsonOwner === "external"
          ? "warning"
          : undefined;
    const out: { label: string; value: string; color?: string }[] = [
      { label: t("state.codexDir"), value: cleanWinPath(state.codexDir) },
      { label: t("state.authJson"), value: ownerLabel, color: ownerColor },
    ];
    if (toml.provider || toml.model) {
      out.push({
        label: t("state.configToml"),
        value: `${toml.provider ?? "?"} / ${toml.model ?? "?"}`,
      });
    }
    if (state.activeOverride) {
      out.push({
        label: t("state.override"),
        value: `${state.activeOverride.providerId} / ${state.activeOverride.modelId}`,
        color: "processing",
      });
    }
    return out;
  }, [state, t]);

  // Advance the ticker. Reset index when the item set changes size.
  useEffect(() => {
    if (items.length <= 1) return;
    const tid = setInterval(() => setIdx((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(tid);
  }, [items.length]);

  if (!state || items.length === 0) return null;

  const cur = items[idx % items.length];
  const details = (
    <div style={{ width: narrow ? "auto" : 520, maxWidth: "92vw" }}>
      <CurrentStateCard state={state} dirInfo={dirInfo} onReload={() => void load()} />
    </div>
  );

  const chip = (
    <Tag
      icon={<DashboardOutlined />}
      color={state.activeOverride ? "processing" : "default"}
      style={{
        cursor: "pointer",
        marginInlineEnd: 0,
        maxWidth: 300,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
      title={t("state.title")}
      onClick={narrow ? () => setOpen(true) : undefined}
    >
      {!narrow && (
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {t("state.title")}
        </Typography.Text>
      )}
      {!narrow && (
        <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cur.label}: {middleEllipsis(cur.value, 34)}
        </span>
      )}
    </Tag>
  );

  if (narrow) {
    return (
      <>
        {chip}
        <Modal
          open={open}
          onCancel={() => setOpen(false)}
          footer={null}
          title={t("state.title")}
          width={560}
          destroyOnClose
        >
          {details}
        </Modal>
      </>
    );
  }

  return (
    <Popover content={details} trigger="click" placement="bottomRight" destroyTooltipOnHide>
      {chip}
    </Popover>
  );
}
