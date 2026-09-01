import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean; message: string | null };

/** Ключ на один перезапуск: чтобы не уйти в бесконечную перезагрузку. */
const RELOADED = "mr-admin-reloaded";

/**
 * Ошибка отрисовки не должна оставлять пустой экран.
 *
 * Отдельно ловим случай, когда браузер держит старую страницу, а на сервере уже
 * новая сборка: имена файлов там другие, подгрузка куска падает, и панель
 * замирает тёмным фоном без содержимого. Такое лечится перезагрузкой, и мы
 * делаем её сами — но ровно один раз, иначе при настоящей поломке страница
 * будет перезагружаться по кругу.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, message: error instanceof Error ? error.message : null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const stale =
      /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
        error.message,
      );

    if (stale && sessionStorage.getItem(RELOADED) === null) {
      sessionStorage.setItem(RELOADED, "1");
      window.location.reload();
      return;
    }

    console.error("Панель упала", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="login-shell">
        <div className="login-card">
          <h1 className="login-title">Панель не открылась</h1>
          <p className="login-copy">
            {this.state.message ?? "Неизвестная ошибка"}. Обновите страницу — обычно этого хватает.
          </p>
          <button
            className="button button-primary"
            type="button"
            onClick={() => {
              sessionStorage.removeItem(RELOADED);
              window.location.reload();
            }}
          >
            Обновить страницу
          </button>
        </div>
      </main>
    );
  }
}
