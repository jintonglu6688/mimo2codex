import { useTranslation } from "react-i18next";
import { Alert, Collapse, Steps, Typography } from "antd";
import { MobileOutlined } from "@ant-design/icons";

// Self-contained guide card for "control this Codex from your phone" — the
// official OpenAI Codex mobile/remote feature. mimo2codex can't implement the
// relay (it's OpenAI infrastructure); its job is to keep the ChatGPT login
// alive (the "preserve login" apply mode) so that official feature keeps
// working while the model backend still routes through the proxy.
//
// Rendered as a Collapse, COLLAPSED by default, so it stays out of the way
// until the user wants it. Lives in its own file so it can be dropped into /
// removed from CodexEnable without touching the rest of the page.
export function MobileRemoteCard() {
  const { t } = useTranslation("codexEnable");
  return (
    <Collapse
      style={{ marginBottom: 16 }}
      items={[
        {
          key: "mobile-remote",
          label: (
            <span>
              <MobileOutlined /> <strong>{t("mobileRemote.title")}</strong>
            </span>
          ),
          children: (
            <>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                {t("mobileRemote.intro")}
              </Typography.Paragraph>
              <Steps
                direction="vertical"
                size="small"
                current={-1}
                items={[
                  {
                    title: t("mobileRemote.step1Title"),
                    description: t("mobileRemote.step1Desc"),
                  },
                  {
                    title: t("mobileRemote.step2Title"),
                    description: t("mobileRemote.step2Desc"),
                  },
                  {
                    title: t("mobileRemote.step3Title"),
                    description: t("mobileRemote.step3Desc"),
                  },
                  {
                    title: t("mobileRemote.step4Title"),
                    description: t("mobileRemote.step4Desc"),
                  },
                ]}
              />
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
                message={t("mobileRemote.caveatTitle")}
                description={t("mobileRemote.caveatBody")}
              />
            </>
          ),
        },
      ]}
    />
  );
}
