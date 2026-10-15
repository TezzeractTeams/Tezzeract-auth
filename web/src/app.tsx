import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { AuthApi } from "./api/auth";
import { ApiProvider } from "./api/context";
import { ClientConfigProvider } from "./theme/ClientConfigProvider";
import { clientIdFrom } from "./oidc/params";
import { ErrorPage } from "./routes/ErrorPage";
import { ForgotPassword } from "./routes/ForgotPassword";
import { Login } from "./routes/Login";
import { Logout } from "./routes/Logout";
import { Mfa } from "./routes/Mfa";
import { ResetPassword } from "./routes/ResetPassword";
import { Signup } from "./routes/Signup";
import { VerifyEmail } from "./routes/VerifyEmail";

/**
 * Routes and providers.
 *
 * The theme provider sits inside the router because the client_id it themes
 * from comes from the query string, which only exists once routing is active.
 */
function ThemedRoutes(): JSX.Element {
  const location = useLocation();

  return (
    <ClientConfigProvider clientId={clientIdFrom(location.search)}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/mfa" element={<Mfa />} />
        <Route path="/logout" element={<Logout />} />
        <Route path="/error" element={<ErrorPage />} />

        {/* The root is not a screen; anyone arriving there is signing in. */}
        <Route path="/" element={<Navigate to={`/login${location.search}`} replace />} />

        {/*
          An unknown path is a broken or tampered link, which is the error
          screen's job rather than a 404 of its own.
        */}
        <Route path="*" element={<Navigate to="/error" replace />} />
      </Routes>
    </ClientConfigProvider>
  );
}

export function App({ api }: { api: AuthApi }): JSX.Element {
  return (
    <ApiProvider api={api}>
      <ThemedRoutes />
    </ApiProvider>
  );
}
