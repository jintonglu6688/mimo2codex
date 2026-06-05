import { useEffect, useState } from "react";
import { Button, Modal, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAppConfig } from "../contexts/AppConfigContext";
import {
  RELEASE_NOTES,
  unseenReleases,
  type BilingualText,
  type ReleaseHighlight,
  type ReleaseNote,
} from "../release-notes";

const STORAGE_KEY = "mimo2codex:lastSeenReleaseVersion";

// Pick the side of a BilingualText matching the current i18n language.
function pick(text: BilingualText, lang: string): string {
  return lang.startsWith("zh") ? text.zh : text.en;
}

const KIND_COLORS: Record<NonNullable<ReleaseHighlight["kind"]>, string> = {
  new: "blue",
  improved: "geekblue",
  fixed: "green",
  doc: "default",
};

export function WhatsNewModal() {
  const { t, i18n } = useTranslation("whatsNew");
  const { versionInfo } = useAppConfig();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ReleaseNote[]>([]);

  useEffect(() => {
    // Wait until we know the running version. versionInfo arrives on mount
    // via AppConfigContext; before then we render nothing.
    const current = versionInfo?.current;
    if (!current) return;
    const lastSeen = window.localStorage.getItem(STORAGE_KEY);
    const list = unseenReleases(lastSeen, current);
    if (list.length === 0) return;
    setEntries(list);
    setOpen(true);
  }, [versionInfo?.current]);

  function close(markSeen: boolean): void {
    if (markSeen && versionInfo?.current) {
      // Mark the *running* version as seen so even future notes for older
      // versions (e.g. someone backports a release-notes entry) don't re-pop.
      // Also save the latest release-notes version, whichever is greater —
      // protects against the version string being temporarily empty.
      const latestKnown = RELEASE_NOTES[0]?.version ?? versionInfo.current;
      window.localStorage.setItem(
        STORAGE_KEY,
        latestKnown.localeCompare(versionInfo.current) > 0
          ? latestKnown
          : versionInfo.current,
      );
    }
    setOpen(false);
  }

  if (entries.length === 0) return null;

  const lang = i18n.language || "zh";
  const multi = entries.length > 1;

  return (
    <Modal
      open={open}
      onCancel={() => close(false)}
      title={<span style={{ fontSize: 18 }}>🎉 {t("title")}</span>}
      width={980}
      style={{ maxWidth: "94vw" }}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Button type="text" onClick={() => close(true)}>
            {t("actions.dontShowAgain")}
          </Button>
          <Button type="primary" onClick={() => close(true)}>
            {t("actions.close")}
          </Button>
        </div>
      }
      destroyOnClose
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        {multi ? t("subtitleMulti", { count: entries.length }) : t("subtitle")}
      </Typography.Paragraph>

      {entries.map((note, idx) => (
        <ReleaseSection
          key={note.version}
          note={note}
          lang={lang}
          showDivider={idx > 0}
          navigate={(path) => {
            close(true);
            navigate(path);
          }}
          openHref={(href) => {
            window.open(href, "_blank", "noopener,noreferrer");
          }}
        />
      ))}

      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 12, marginTop: 16, marginBottom: 0 }}
      >
        {t("footerHint")}
      </Typography.Paragraph>
    </Modal>
  );
}

function ReleaseSection({
  note,
  lang,
  showDivider,
  navigate,
  openHref,
}: {
  note: ReleaseNote;
  lang: string;
  showDivider: boolean;
  navigate: (path: string) => void;
  openHref: (href: string) => void;
}) {
  const { t } = useTranslation("whatsNew");
  return (
    <div style={{ marginTop: showDivider ? 28 : 8 }}>
      {showDivider && (
        <div
          style={{
            height: 1,
            background: "var(--ant-color-border-secondary, #f0f0f0)",
            margin: "0 0 18px",
          }}
        />
      )}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {pick(note.title, lang)}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {t("versionLabel", { version: note.version, date: note.date })}
        </Typography.Text>
      </div>
      {note.summary && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
          {pick(note.summary, lang)}
        </Typography.Paragraph>
      )}

      <GroupedHighlights
        highlights={note.highlights}
        lang={lang}
        navigate={navigate}
        openHref={openHref}
      />
    </div>
  );
}

// Group highlights by kind (New → Improved → Fixed → Docs) so the modal reads
// as tidy sections instead of an interleaved list. Each section gets one
// header tag; the per-row tag is dropped to avoid repeating it on every row.
const KIND_ORDER: Array<NonNullable<ReleaseHighlight["kind"]>> = [
  "new",
  "improved",
  "fixed",
  "doc",
];

function GroupedHighlights({
  highlights,
  lang,
  navigate,
  openHref,
}: {
  highlights: ReleaseHighlight[];
  lang: string;
  navigate: (path: string) => void;
  openHref: (href: string) => void;
}) {
  const { t } = useTranslation("whatsNew");
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: highlights.filter((h) => (h.kind ?? "new") === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 18 }}>
      {groups.map((g) => (
        <div key={g.kind}>
          <Tag color={KIND_COLORS[g.kind]} style={{ marginInlineEnd: 0, marginBottom: 8 }}>
            {t(`kind.${g.kind}`)} · {g.items.length}
          </Tag>
          {/* Responsive grid: 2 columns on wide screens, 1 when narrow. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 10,
              alignItems: "stretch",
            }}
          >
            {g.items.map((h, i) => (
              <HighlightRow
                key={i}
                highlight={h}
                lang={lang}
                navigate={navigate}
                openHref={openHref}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HighlightRow({
  highlight,
  lang,
  navigate,
  openHref,
}: {
  highlight: ReleaseHighlight;
  lang: string;
  navigate: (path: string) => void;
  openHref: (href: string) => void;
}) {
  const { t } = useTranslation("whatsNew");
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "32px minmax(0, 1fr)",
        gap: 12,
        padding: "10px 14px",
        height: "100%",
        border: "1px solid var(--ant-color-border-secondary, #f0f0f0)",
        borderRadius: 10,
        background: "var(--ant-color-fill-quaternary, rgba(0,0,0,0.02))",
      }}
    >
      <div style={{ fontSize: 20, lineHeight: "24px", color: "var(--ant-color-primary, #1677ff)" }}>
        {highlight.icon ?? "•"}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>{pick(highlight.title, lang)}</strong>
        </div>
        <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.65 }}>
          {pick(highlight.description, lang)}
        </div>
        {highlight.location && (
          <div
            style={{
              fontSize: 12,
              marginTop: 6,
              color: "var(--ant-color-text-secondary, #57606a)",
            }}
          >
            <strong>{t("locationLabel")}:</strong> {pick(highlight.location, lang)}
          </div>
        )}
        {highlight.ctaLabel && (highlight.ctaPath || highlight.ctaHref) && (
          <Button
            size="small"
            type="link"
            style={{ paddingLeft: 0, marginTop: 6 }}
            onClick={() => {
              if (highlight.ctaPath) navigate(highlight.ctaPath);
              else if (highlight.ctaHref) openHref(highlight.ctaHref);
            }}
          >
            {pick(highlight.ctaLabel, lang)} →
          </Button>
        )}
      </div>
    </div>
  );
}
