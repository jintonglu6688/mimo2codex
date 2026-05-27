import { useEffect, useState } from "react";
import { Button, Card, Skeleton, Alert, Collapse, Tag, Space, Typography, message } from "antd";
import { DownloadOutlined, GithubOutlined, CopyOutlined, AppleOutlined, WindowsOutlined, SwapOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  fetchLatestDesktopRelease,
  detectPlatform,
  type DesktopRelease,
  type DesktopAsset,
  type DetectedPlatform,
  type DetectedArch,
} from "../api/githubReleases";

const PLATFORM_LABEL: Record<string, string> = {
  "win-x64": "Windows (Intel / AMD 64)",
  "win-arm64": "Windows ARM64",
  "mac-x64": "macOS Intel",
  "mac-arm64": "macOS Apple Silicon",
};

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 ** 3)).toFixed(2) + " GB";
  if (bytes >= 1024 * 1024) return (bytes / (1024 ** 2)).toFixed(1) + " MB";
  return Math.ceil(bytes / 1024) + " KB";
}

function platformIcon(platform: "win" | "mac") {
  return platform === "win" ? <WindowsOutlined /> : <AppleOutlined />;
}

export default function Download() {
  const { t } = useTranslation("download");
  const [release, setRelease] = useState<DesktopRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Detection is async (uses navigator.userAgentData.getHighEntropyValues
  // when available). User can override via the "switch arch" link below
  // the primary CTA — Safari can't tell M-series from Intel on Mac, so the
  // default may be wrong and the user needs an escape hatch.
  const [detected, setDetected] = useState<{ platform: DetectedPlatform; arch: DetectedArch } | null>(null);
  const [override, setOverride] = useState<{ platform: DetectedPlatform; arch: DetectedArch } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLatestDesktopRelease()
      .then((rel) => { if (!cancelled) setRelease(rel); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    detectPlatform().then((d) => { if (!cancelled) setDetected(d); });
    return () => { cancelled = true; };
  }, []);

  const platform = override?.platform ?? detected?.platform ?? "unknown";
  const arch = override?.arch ?? detected?.arch ?? "unknown";
  const primaryKey = `${platform}-${arch}`;
  // Primary install format per platform:
  //   Windows → .exe  (NSIS installer)
  //   macOS   → .zip  (Finder unzips → drag .app to /Applications)
  // The .dmg target was dropped from CI builds because GitHub-runner hdiutil
  // versions produce unmountable images on consumer Macs — see
  // electron-builder.yml. If a maintainer ever uploads a .dmg manually
  // alongside (e.g. a locally-built signed dmg), prefer it as primary for
  // Mac since that's the more familiar install format.
  const primaryAsset: DesktopAsset | undefined = (() => {
    if (!release) return undefined;
    const matching = release.assets.filter((a) => `${a.platform}-${a.arch}` === primaryKey);
    if (platform === "mac") {
      return matching.find((a) => a.ext === "dmg") ?? matching.find((a) => a.ext === "zip");
    }
    return matching.find((a) => a.ext === "exe");
  })();
  const otherAssets = release?.assets.filter((a) => a !== primaryAsset) ?? [];

  // Mac users see a "switch arch" link because Safari can't distinguish
  // M-series from Intel via UA. On Windows arm64 vs x64 detection is more
  // reliable, but we still offer the toggle to be safe.
  const altArch: "x64" | "arm64" | null =
    platform === "mac" ? (arch === "arm64" ? "x64" : "arm64") :
    platform === "win" ? (arch === "arm64" ? "x64" : "arm64") :
    null;
  const altLabel = altArch
    ? PLATFORM_LABEL[`${platform}-${altArch}`] ?? `${platform}-${altArch}`
    : "";

  const copySha = async (sha?: string) => {
    if (!sha) return;
    try {
      await navigator.clipboard.writeText(sha);
      message.success(t("copied"));
    } catch {
      message.error(t("copyFailed"));
    }
  };

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <img src="/favicon.svg" alt="mimo2codex" width={128} height={128} style={{ marginBottom: 16 }} />
        <Typography.Title level={2} style={{ marginBottom: 4 }}>
          {t("title")}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ fontSize: 16 }}>
          {t("tagline")}
        </Typography.Paragraph>
      </div>

      {loading && <Skeleton active paragraph={{ rows: 4 }} />}

      {error && (
        <Alert
          type="error"
          showIcon
          message={t("fetchFailed.title")}
          description={
            <Space direction="vertical">
              <span>{t("fetchFailed.detail", { error })}</span>
              <Button
                type="primary"
                href="https://github.com/7as0nch/mimo2codex/releases"
                target="_blank"
                rel="noreferrer"
                icon={<GithubOutlined />}
              >
                {t("fetchFailed.fallback")}
              </Button>
            </Space>
          }
        />
      )}

      {!loading && !error && !release && (
        <Alert
          type="info"
          showIcon
          message={t("notReleasedYet.title")}
          description={
            <Space direction="vertical" style={{ width: "100%" }}>
              <span>{t("notReleasedYet.detail")}</span>
              <Typography.Text code style={{ display: "block", marginTop: 8 }}>
                npm install -g mimo2codex
              </Typography.Text>
            </Space>
          }
        />
      )}

      {release && (
        <Card style={{ marginBottom: 24 }}>
          {primaryAsset ? (
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <Space size={8}>
                <Tag color="blue">v{release.version}</Tag>
                <Typography.Text type="secondary">
                  {new Date(release.publishedAt).toLocaleDateString()}
                </Typography.Text>
              </Space>
              <Button
                type="primary"
                size="large"
                icon={<DownloadOutlined />}
                href={primaryAsset.downloadUrl}
                target="_blank"
                rel="noreferrer"
                block
                style={{ height: 56, fontSize: 16 }}
              >
                {t("primaryCta", {
                  label: PLATFORM_LABEL[primaryKey] ?? `${primaryAsset.platform}-${primaryAsset.arch}`,
                  size: humanSize(primaryAsset.size),
                })}
              </Button>
              {primaryAsset.sha256 && (
                <Space size={4}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>SHA256:</Typography.Text>
                  <Typography.Text code copyable={{ text: primaryAsset.sha256 }} style={{ fontSize: 11 }}>
                    {primaryAsset.sha256.slice(0, 24)}…
                  </Typography.Text>
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={() => copySha(primaryAsset.sha256)}
                  />
                </Space>
              )}
              {altArch && (platform === "mac" || platform === "win") && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t("switchArch.detected", { label: PLATFORM_LABEL[primaryKey] ?? primaryKey })}
                  {" · "}
                  <Button
                    size="small"
                    type="link"
                    icon={<SwapOutlined />}
                    style={{ padding: 0, height: "auto", fontSize: 12 }}
                    onClick={() => setOverride({ platform, arch: altArch })}
                  >
                    {t("switchArch.switch", { label: altLabel })}
                  </Button>
                </Typography.Text>
              )}
            </Space>
          ) : (
            <Alert
              type="warning"
              showIcon
              message={t("noMatchPlatform.title")}
              description={t("noMatchPlatform.detail")}
            />
          )}

          {otherAssets.length > 0 && (
            <Collapse
              ghost
              style={{ marginTop: 16 }}
              items={[{
                key: "others",
                label: t("otherPlatforms"),
                children: (
                  <Space direction="vertical" style={{ width: "100%" }} size={8}>
                    {otherAssets.map((a) => (
                      <div
                        key={a.name}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "8px 12px",
                          border: "1px solid #f0f0f0",
                          borderRadius: 6,
                        }}
                      >
                        {platformIcon(a.platform)}
                        <div style={{ flex: 1 }}>
                          <div>{PLATFORM_LABEL[`${a.platform}-${a.arch}`] ?? a.name}</div>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {a.name} · {humanSize(a.size)}
                          </Typography.Text>
                        </div>
                        <Button
                          size="small"
                          href={a.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          icon={<DownloadOutlined />}
                        >
                          {t("download")}
                        </Button>
                      </div>
                    ))}
                  </Space>
                ),
              }]}
            />
          )}
        </Card>
      )}

      <Card title={t("why.title")} style={{ marginBottom: 24 }}>
        <Space direction="vertical" size={12}>
          <div>🖥️ <strong>{t("why.bg.title")}</strong> — {t("why.bg.detail")}</div>
          <div>⚙️ <strong>{t("why.tray.title")}</strong> — {t("why.tray.detail")}</div>
          <div>🔄 <strong>{t("why.autostart.title")}</strong> — {t("why.autostart.detail")}</div>
        </Space>
      </Card>

      {/*
        Mac install steps are pulled out into their own info-Alert above the
        generic security warning. Two reasons:
        1. The xattr command is mandatory for unsigned .app launched from a
           browser-downloaded .zip — without it, every Mac user hits "App is
           damaged, can't be opened". Burying it in a warning paragraph means
           users skim past it and file a bug.
        2. The command needs to be copy-pasted exactly; Antd's `copyable`
           code block is the right primitive. A free-text paragraph forces
           manual selection.
        Shown to mac platform (detected or overridden); fallback warning below
        still covers the "user didn't read the steps" path.
      */}
      {platform === "mac" && (
        <Alert
          type="info"
          showIcon
          message={t("macSteps.title")}
          description={
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <span>{t("macSteps.intro")}</span>
              <ol style={{ paddingLeft: 22, margin: 0 }}>
                <li style={{ marginBottom: 6 }}>{t("macSteps.s1")}</li>
                <li style={{ marginBottom: 6 }}>{t("macSteps.s2")}</li>
                <li style={{ marginBottom: 6 }}>
                  <div>{t("macSteps.s3")}</div>
                  <Typography.Text
                    code
                    copyable={{ text: "xattr -cr /Applications/mimo2codex.app" }}
                    style={{ display: "inline-block", marginTop: 4, fontSize: 13 }}
                  >
                    xattr -cr /Applications/mimo2codex.app
                  </Typography.Text>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t("macSteps.s3Hint")}
                    </Typography.Text>
                  </div>
                </li>
                <li>{t("macSteps.s4")}</li>
              </ol>
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Alert
        type="warning"
        showIcon
        message={t("security.title")}
        description={
          <Space direction="vertical">
            <span>{t("security.mac")}</span>
            <span>{t("security.win")}</span>
            <span>{t("security.sha")}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              {t("security.uninstall")}
            </Typography.Text>
          </Space>
        }
        style={{ marginBottom: 24 }}
      />

      <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
        <Link to="/docs"><GithubOutlined /> {t("cliHint")}</Link>
      </Typography.Paragraph>
    </div>
  );
}
