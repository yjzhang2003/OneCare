"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root export,
// where React 19 no longer puts it, and falls back to the deleted ReactDOM.render.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import { Modal, Space, Typography } from "@arco-design/web-react";
import { useState } from "react";

// What a judge sees on arrival. Three facts, because a demo that does not say these
// first is asking to be read as something it is not: the records are a real enterprise's
// desensitised export, parts of the dataset were reprocessed to make a demo possible,
// and this door is read-only.
export function WelcomeDialog({ open }: Readonly<{ open: boolean }>) {
  // Seeded from the prop rather than set in an effect: the flag arrives with the page
  // (the 评委通道 link puts it in the URL), so there is nothing to wait for and nothing
  // for a first render to miss. Dismissing it is the only state change there is.
  const [dismissed, setDismissed] = useState(false);
  const visible = open && !dismissed;
  const setVisible = (next: boolean) => setDismissed(!next);

  return (
    <Modal
      title="关于这份演示数据"
      visible={visible}
      unmountOnExit
      okText="我知道了"
      onOk={() => setVisible(false)}
      onCancel={() => setVisible(false)}
      cancelButtonProps={{ style: { display: "none" } }}
    >
      <Space direction="vertical" size="medium" style={{ width: "100%" }}>
        <Typography.Paragraph style={{ margin: 0 }}>
          工单来自海信提供的售后周报导出，已<b>脱敏</b>：不含姓名、电话、地址等任何个人身份信息，用户与设备以
          <code> U-xxxxxxxx </code>/<code> D-xxxxxxxx </code>标识代替。
        </Typography.Paragraph>
        <Typography.Paragraph style={{ margin: 0 }}>
          为了让演示成立，数据经过<b>再加工</b>：时间轴按原始相对结构整体平移到近期，多数记录的 AI
          打标由脚本合成并盖有 <code>打标来源 = demo-seed</code>；真实调用 aily 产出的
          19 条完整保留。<b>它不是海信的真实生产数据。</b>
        </Typography.Paragraph>
        <Typography.Paragraph style={{ margin: 0 }}>
          评委通道为<b>只读</b>：可以查看全部页面、筛选、打开任意工单与画像，但不会改动数据，也不会给任何人发消息。
        </Typography.Paragraph>
      </Space>
    </Modal>
  );
}
