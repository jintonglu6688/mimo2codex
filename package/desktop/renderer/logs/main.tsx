import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <ConfigProvider>
    <App />
  </ConfigProvider>
);
