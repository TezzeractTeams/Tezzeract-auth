import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app";
import { resolveApi } from "./api/auth";
import "./index.css";

/**
 * Entry point.
 *
 * The API implementation is resolved before the first render so no screen has
 * to cope with it being absent. In a production build the mock branch is
 * eliminated and only the real implementation is bundled.
 */
async function start(): Promise<void> {
  const container = document.getElementById("root");
  if (!container) throw new Error("#root is missing from index.html");

  const api = await resolveApi();

  createRoot(container).render(
    <StrictMode>
      <BrowserRouter>
        <App api={api} />
      </BrowserRouter>
    </StrictMode>,
  );
}

void start();
