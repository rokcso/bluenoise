import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");
const root = createRoot(rootEl);
root.render(
	<StrictMode>
		<App />
	</StrictMode>,
);
