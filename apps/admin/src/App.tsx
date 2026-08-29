import {
  Navigate,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, Store } from "lucide-react";
import { Suspense, lazy, useState, type ReactNode } from "react";

import { OrdersPage } from "./app/orders/OrdersPage";
import { AdminLayout } from "./components/layout/AdminLayout";
import { api, getToken, setToken, tenant, type ApiError } from "./api";
import { AdminSessionProvider } from "./lib/admin-session";
import { Button } from "./ui";

const ReservationsPage = lazy(() =>
  import("./app/reservations/ReservationsPage").then((module) => ({ default: module.ReservationsPage })),
);
const ExtrasTab = lazy(() => import("./ExtrasTab").then((module) => ({ default: module.ExtrasTab })));
const FeedbackTab = lazy(() => import("./FeedbackTab").then((module) => ({ default: module.FeedbackTab })));
const GuestsTab = lazy(() => import("./GuestsTab").then((module) => ({ default: module.GuestsTab })));
const IikoTab = lazy(() => import("./IikoTab").then((module) => ({ default: module.IikoTab })));
const MenuTab = lazy(() => import("./MenuTab").then((module) => ({ default: module.MenuTab })));
const NotificationsTab = lazy(() =>
  import("./NotificationsTab").then((module) => ({ default: module.NotificationsTab })),
);
const PromoCodesTab = lazy(() => import("./PromoCodesTab").then((module) => ({ default: module.PromoCodesTab })));
const PromosTab = lazy(() => import("./PromosTab").then((module) => ({ default: module.PromosTab })));
const RestaurantsTab = lazy(() => import("./RestaurantsTab").then((module) => ({ default: module.RestaurantsTab })));
const SyncTab = lazy(() => import("./SyncTab").then((module) => ({ default: module.SyncTab })));
const ZonesTab = lazy(() => import("./ZonesTab").then((module) => ({ default: module.ZonesTab })));

const rootRoute = createRootRoute({
  component: AdminLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate replace to="/orders" />,
});

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders",
  component: OrdersPage,
});

function LegacyScreen({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<RouteSkeleton />}>
      <div className="legacy-wrap page-stack">{children}</div>
    </Suspense>
  );
}

function RouteSkeleton() {
  return (
    <div className="page-stack">
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
    </div>
  );
}

const reservationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reservations",
  component: () => (
    <LegacyScreen>
      <ReservationsPage />
    </LegacyScreen>
  ),
});

const feedbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/feedback",
  component: () => (
    <LegacyScreen>
      <FeedbackTab />
    </LegacyScreen>
  ),
});

const menuRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/menu",
  component: () => (
    <LegacyScreen>
      <MenuTab />
    </LegacyScreen>
  ),
});

const extrasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/extras",
  component: () => (
    <LegacyScreen>
      <ExtrasTab />
    </LegacyScreen>
  ),
});

const promosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/promos",
  component: () => (
    <LegacyScreen>
      <PromosTab />
    </LegacyScreen>
  ),
});

const promoCodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/promo-codes",
  component: () => (
    <LegacyScreen>
      <PromoCodesTab />
    </LegacyScreen>
  ),
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications",
  component: () => (
    <LegacyScreen>
      <NotificationsTab />
    </LegacyScreen>
  ),
});

const guestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/guests",
  component: () => (
    <LegacyScreen>
      <GuestsTab />
    </LegacyScreen>
  ),
});

const restaurantsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/restaurants",
  component: () => (
    <LegacyScreen>
      <RestaurantsTab />
    </LegacyScreen>
  ),
});

const zonesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/zones",
  component: () => (
    <LegacyScreen>
      <ZonesTab />
    </LegacyScreen>
  ),
});

const iikoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/iiko",
  component: () => (
    <LegacyScreen>
      <IikoTab />
    </LegacyScreen>
  ),
});

const syncRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sync",
  component: () => (
    <LegacyScreen>
      <SyncTab />
    </LegacyScreen>
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  ordersRoute,
  reservationsRoute,
  feedbackRoute,
  menuRoute,
  extrasRoute,
  promosRoute,
  promoCodesRoute,
  notificationsRoute,
  guestsRoute,
  restaurantsRoute,
  zonesRoute,
  iikoRoute,
  syncRoute,
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: (result) => {
      setToken(result.access_token);
      onDone();
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  return (
    <main className="login-shell">
      <form
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault();
          setFailure(null);
          login.mutate();
        }}
      >
        <div className="login-brand">
          <div className="login-mark">
            <Store size={18} aria-hidden />
          </div>
          <div>
            <h1 className="login-title">{tenant.branding.displayName}</h1>
            <p className="login-copy">Панель управления рестораном</p>
          </div>
        </div>

        <label className="field">
          <span className="field-label">Почта</span>
          <input
            autoComplete="username"
            className="input"
            placeholder="name@mamaroma.ru"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Пароль</span>
          <input
            autoComplete="current-password"
            className="input"
            placeholder="Введите пароль"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {failure ? <div className="form-error">{failure}</div> : null}

        <Button disabled={login.isPending} type="submit">
          <LockKeyhole size={15} aria-hidden />
          {login.isPending ? "Входим..." : "Войти"}
        </Button>
      </form>
    </main>
  );
}

function SessionSkeleton() {
  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
      </div>
    </main>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const [authorized, setAuthorized] = useState(getToken() !== null);

  const me = useQuery({ queryKey: ["me"], queryFn: api.me, enabled: authorized, retry: false });

  if (!authorized || me.isError) {
    return (
      <Login
        onDone={() => {
          queryClient.removeQueries({ queryKey: ["me"] });
          setAuthorized(true);
        }}
      />
    );
  }

  if (me.isPending) {
    return <SessionSkeleton />;
  }

  return (
    <AdminSessionProvider
      value={{
        staff: me.data,
        logout: () => {
          setToken(null);
          setAuthorized(false);
          queryClient.clear();
        },
      }}
    >
      <RouterProvider router={router} />
    </AdminSessionProvider>
  );
}
