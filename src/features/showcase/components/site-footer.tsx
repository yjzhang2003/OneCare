import { OneCareLogo } from "./onecare-logo";

export function SiteFooter() {
  return (
    <footer className="site-footer public-footer">
      <div className="footer-top">
        <div className="footer-brand">
          <OneCareLogo decorative size={52} tone="light" />
          <div>
            <strong>万护 OneCare</strong>
            <span>AI 用户服务全链路闭环引擎</span>
          </div>
        </div>
        <nav aria-label="页尾导航">
          <a href="#home">首页</a>
          <a href="#perspectives">四个视角</a>
          <a href="#architecture">闭环架构</a>
          <a href="#team">团队</a>
        </nav>
      </div>
      <div className="footer-bottom">
        <p>
          当前为万护 OneCare 方案原型，尚未接入真实业务数据或 AI 服务。
        </p>
        <a className="back-to-top" href="#home" aria-label="返回首页">
          返回首页
        </a>
      </div>
    </footer>
  );
}
