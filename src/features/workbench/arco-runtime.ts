// Arco on React 19, registered once for the whole console. Import this before any
// `@arco-design/web-react` import in a client component.
//
// Arco reads createRoot off the "react-dom" root export, where React 19 no longer puts
// it, and silently falls back to the deleted ReactDOM.render — so every imperative mount
// (Message, Notification, Modal.confirm) dies at runtime with "CopyReactDOM.render is not
// a function", with a green build and a green type-check. `react-19-adapter` is Arco's own
// fix: it re-registers createRoot from react-dom/client.
//
// Both copies are imported on purpose, and that is the part worth keeping. Arco ships two
// builds — `main: ./lib/index.js` and `module: ./es/index.js` — each with its own private
// `_util/react-dom` module holding its own `createRoot`. Patching one does nothing for the
// other. Node's resolution (vitest) takes `lib`; a bundler's (Next, in the browser) takes
// `es`. So importing only the lib adapter — which is what every client component here did
// until a live click-through caught it — leaves the browser's copy unpatched: the toasts
// throw in the product while the React 19 guard test passes in CI, because the test and
// the browser were never loading the same Arco.
import "@arco-design/web-react/es/_util/react-19-adapter";
import "@arco-design/web-react/lib/_util/react-19-adapter";
