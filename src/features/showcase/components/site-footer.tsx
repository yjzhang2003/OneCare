export function SiteFooter() {
  return (
    <footer className="site-footer public-footer">
      <div>
        <strong>OneCare</strong>
        <span>AI 用户服务全链路闭环引擎</span>
        <small>Typeface: MiSans</small>
      </div>
      <p>
        当前为 OneCare 方案原型，尚未接入真实业务数据或 AI 服务。
      </p>
      <nav aria-label="页尾导航">
        <a href="#perspectives">返回四个视角</a>
        <a href="#architecture">返回五层引擎</a>
        <a href="#team">返回团队</a>
      </nav>
      <a className="back-to-top" href="#top" aria-label="返回顶部">
        返回顶部
      </a>
    </footer>
  );
}
