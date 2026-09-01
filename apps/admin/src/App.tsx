import {
  Navigate,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, LockKeyhole, Store } from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { OrdersPage } from "./app/orders/OrdersPage";
import { AdminLayout } from "./components/layout/AdminLayout";
import { ApiError, api, getToken, mediaUrl, setToken, tenant } from "./api";
import { AdminSessionProvider } from "./lib/admin-session";
import { brightness, busyness } from "./lib/blurhash";
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

/**
 * Кадр зала для экрана входа. Список ресторанов открыт и без входа, поэтому
 * снимок можно взять до авторизации.
 *
 * Берём не любой, а из трети самых тёмных: поверх кадра лежит текст и белая
 * карточка, и на залитом солнцем зале с красными скатертями они тонут, а на
 * вечернем — читаются. Светлоту узнаём из хеша размытия, не скачивая снимки.
 * Внутри отобранных крутим по дню года: панель выглядит по-разному в разные
 * дни, но не мельтешит при каждой перерисовке.
 */
function useHallShot(): string | null {
  const halls = useQuery({
    queryKey: ["halls"],
    queryFn: api.restaurants,
    staleTime: 12 * 60 * 60 * 1000,
    retry: false,
  });

  /**
   * Годный кадр — тёмный и спокойный. Одной темноты мало: витрина с бутылками
   * и цветами тоже тёмная, но текст на ней не читается никаким затемнением.
   * Поэтому считаем и пестроту, и берём восьмёрку лучших по сумме.
   */
  const shots = (halls.data ?? [])
    .filter((item) => Boolean(item.image_url))
    .map((item) => ({
      item,
      score: brightness(item.image_blurhash) * 2 + busyness(item.image_blurhash),
    }))
    .sort((left, right) => left.score - right.score)
    .slice(0, 8)
    .map(({ item }) => item);

  if (shots.length === 0) return null;

  const start = new Date(new Date().getFullYear(), 0, 0);
  const day = Math.floor((Date.now() - start.getTime()) / 86_400_000);

  return mediaUrl(shots[day % shots.length].image_url ?? null);
}

function Login({ onDone }: { onDone: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const hall = useHallShot();

  const login = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: (result) => onDone(result.access_token),
    /** Не уточняем, что именно не сошлось: так не перебрать чужие учётные записи. */
    onError: (error: ApiError) =>
      setFailure(
        error.status === 401 || error.status === 403
          ? "Неверная почта или пароль"
          : error.status === 429
            ? "Слишком много попыток. Подождите несколько минут"
            : "Сервер не отвечает. Попробуйте ещё раз",
      ),
  });

  const ready = email.trim().length > 0 && password.length > 0 && !login.isPending;

  return (
    <main
      className="login-shell"
      style={{ "--brand": tenant.branding.primary } as CSSProperties}
    >
      {hall ? <img alt="" className="login-photo" src={hall} /> : null}
      <div className="login-veil" />

      <div className="login-inner">
        <section className="login-aside">
          <div className="login-aside-brand">
            <div className="login-aside-mark">
              <Store size={18} aria-hidden />
            </div>
            <span>{tenant.branding.displayName}</span>
          </div>

          <h2 className="login-aside-title">Панель управления сетью</h2>
          <p className="login-aside-copy">
            Заказы и брони, меню и цены по ресторанам, зоны доставки, акции и рассылки.
          </p>
        </section>

        <form
          className="login-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            setFailure(null);
            login.mutate();
          }}
        >
          <div className="login-head">
            <h1 className="login-title">Вход</h1>
            <p className="login-copy">Для сотрудников сети</p>
          </div>

          <label className="field">
            <span className="field-label">Рабочая почта</span>
            <input
              autoComplete="username"
              autoFocus
              className="input"
              inputMode="email"
              name="email"
              placeholder="name@mamaroma.ru"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">Пароль</span>
            <div className="input-affix">
              <input
                autoComplete="current-password"
                className="input"
                name="password"
                placeholder="••••••••"
                type={visible ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
                className="input-affix-button"
                tabIndex={-1}
                type="button"
                onClick={() => setVisible((shown) => !shown)}
              >
                {visible ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
              </button>
            </div>
          </label>

          {failure ? (
            <div className="form-error" role="alert">
              {failure}
            </div>
          ) : null}

          <Button disabled={!ready} type="submit">
            <LockKeyhole size={15} aria-hidden />
            {login.isPending ? "Входим…" : "Войти"}
          </Button>
        </form>
      </div>
    </main>
  );
}

function SessionFailure({
  message,
  onRetry,
  onSignOut,
}: {
  message: string | null;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <main className="login-shell">
      <div className="login-veil" />
      <div className="login-inner">
      <div className="login-card">
        <div className="login-head">
          <h1 className="login-title">Панель недоступна</h1>
          <p className="login-copy">{message ?? "Сервер не отвечает"}</p>
        </div>

        <Button onClick={onRetry} type="button">
          Повторить
        </Button>
        <Button onClick={onSignOut} tone="quiet" type="button">
          Выйти
        </Button>
      </div>
      </div>
    </main>
  );
}

function SessionSkeleton() {
  return (
    <main className="login-shell">
      <div className="login-veil" />
      <div className="login-inner">
      <div className="login-card">
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
      </div>
      </div>
    </main>
  );
}

export default function App() {
  const queryClient = useQueryClient();

  /**
   * Токен держим в состоянии, а не подсматриваем в хранилище при отрисовке:
   * так вход сразу переключает экран, а не после обновления страницы.
   */
  const [token, setSession] = useState<string | null>(() => getToken());

  const me = useQuery({
    queryKey: ["me", token],
    queryFn: api.me,
    enabled: token !== null,
    retry: false,
  });

  const signOut = useCallback(() => {
    setToken(null);
    setSession(null);
    queryClient.clear();
  }, [queryClient]);

  /**
   * На экран входа выбрасываем только тогда, когда сервер отказал в доступе.
   * Раньше туда же вела любая ошибка — упавшая сеть, пятисотка, — и панель
   * молча просила логин при живом токене: гость вводил его, ничего не менялось,
   * а после обновления страницы всё работало.
   */
  const rejected =
    me.isError && me.error instanceof ApiError && [401, 403].includes(me.error.status);

  useEffect(() => {
    if (rejected) signOut();
  }, [rejected, signOut]);

  if (token === null || rejected) {
    return (
      <Login
        onDone={(fresh) => {
          setToken(fresh);
          setSession(fresh);
        }}
      />
    );
  }

  if (me.isError) {
    return (
      <SessionFailure message={me.error instanceof ApiError ? me.error.message : null} onRetry={() => me.refetch()} onSignOut={signOut} />
    );
  }

  if (me.isPending) {
    return <SessionSkeleton />;
  }

  return (
    <AdminSessionProvider value={{ staff: me.data, logout: signOut }}>
      <RouterProvider router={router} />
    </AdminSessionProvider>
  );
}
