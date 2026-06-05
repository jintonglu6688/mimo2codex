import { useState } from "react";
import { Alert, Button, Space } from "antd";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAppConfig } from "../contexts/AppConfigContext";
import { UpdateModal } from "./UpdateModal";
import { UpdateCommandModal } from "./UpdateCommandModal";

// Top-of-app banner shown when the cached version-check says a newer version
// is available AND the user hasn't explicitly dismissed this exact version.
// Two non-destructive actions ("show command" / "ignore this version") plus
// the primary "update + restart" CTA that opens UpdateModal.
export function UpdateBanner() {
  const { t } = useTranslation("update");
  const { versionInfo, setVersionInfo, refreshVersion } = useAppConfig();
  const [updateOpen, setUpdateOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  // Session-local dismiss — "暂时关闭" hides the banner until the page reloads
  // without persisting anything; "忽略此版本" persists via the backend.
  const [sessionDismissed, setSessionDismissed] = useState(false);

  if (!versionInfo) return null;
  if (!versionInfo.hasUpdate) return null;
  if (versionInfo.preferences.effectivelyDismissed) return null;
  if (versionInfo.preferences.updateCheckDisabled) return null;
  if (sessionDismissed) return null;

  const ignoreThisVersion = async (): Promise<void> => {
    if (!versionInfo.latest) return;
    try {
      const next = await api.updatePreference({ ignoredVersion: versionInfo.latest });
      setVersionInfo(next);
    } catch {
      // best-effort — just hide locally if the persist fails
      setSessionDismissed(true);
    }
  };

  return (
    <>
      <Alert
        type="info"
        showIcon
        closable
        onClose={() => setSessionDismissed(true)}
        style={{ marginBottom: 16 }}
        message={
          <strong>
            {t("banner.title", {
              latest: versionInfo.latest,
              current: versionInfo.current,
            })}
          </strong>
        }
        description={
          <Space wrap size="small" style={{ marginTop: 4 }}>
            {versionInfo.method === "desktop" ? (
              // Desktop shell can't `npm install -g` itself — direct the user
              // to the download page instead of running the update modal.
              <Button
                type="primary"
                size="small"
                href="https://mimodoc.chengj.online/download"
                target="_blank"
                rel="noreferrer"
              >
                {t("banner.actionOpenDownload")}
              </Button>
            ) : (
              <Button type="primary" size="small" onClick={() => setUpdateOpen(true)}>
                {t("banner.actionUpdate")}
              </Button>
            )}
            <Button size="small" onClick={() => setCommandOpen(true)}>
              {t("banner.actionShowCommand")}
            </Button>
            <Button size="small" type="link" onClick={ignoreThisVersion}>
              {t("banner.actionIgnore")}
            </Button>
          </Space>
        }
      />
      <UpdateModal
        open={updateOpen}
        onClose={() => {
          setUpdateOpen(false);
          void refreshVersion();
        }}
      />
      <UpdateCommandModal open={commandOpen} onClose={() => setCommandOpen(false)} />
    </>
  );
}
