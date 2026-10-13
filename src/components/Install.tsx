// "Add to Home Screen" in one tap where the browser allows it.
//   Android / desktop Chrome, Edge, Yandex: the button opens the browser's own install dialog.
//   iPhone / iPad: Apple gives websites no install API, so the button opens a two-step guide
//   that points at Safari's Share button. Inside in-app browsers (Telegram, Instagram…) we ask to
//   open the page in the real browser first, because those cannot add anything to the Home Screen.
import { DownloadSimple, Export, PlusSquare, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useStudio } from '../app/studio';
import { installPrompt, isInAppBrowser, isIos, isStandalone } from '../lib/pwa';
import { mediaUrl } from '../lib/supabase';

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const off = installPrompt.subscribe(() => force((n) => n + 1));
    return () => {
      off();
    };
  }, []);
  return {
    installed: installPrompt.installed() || isStandalone(),
    oneTap: installPrompt.available(),
    ios: isIos(),
    inApp: isInAppBrowser(),
  };
}

export function InstallButton({ variant = 'accent', label = 'Добавить на экран «Домой»' }: { variant?: 'accent' | 'plain'; label?: string }) {
  const st = useInstall();
  const [guide, setGuide] = useState(false);
  const [done, setDone] = useState(false);
  if (st.installed || done) {
    return <span className="install-done">Приложение установлено — откройте его с экрана «Домой»</span>;
  }
  return (
    <>
      <button
        type="button"
        className={`pill-link ${variant === 'accent' ? 'pill-link--accent' : ''}`}
        onClick={async () => {
          if (installPrompt.available()) {
            const ok = await installPrompt.prompt();
            if (ok) setDone(true);
            return;
          }
          setGuide(true);
        }}
      >
        <DownloadSimple size={18} weight="bold" aria-hidden="true" /> {label}
      </button>
      {guide ? <InstallGuide onClose={() => setGuide(false)} ios={st.ios} inApp={st.inApp} /> : null}
    </>
  );
}

function InstallGuide({ onClose, ios, inApp }: { onClose: () => void; ios: boolean; inApp: boolean }) {
  const { tenant } = useStudio();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const logo = mediaUrl(tenant.logo_path);
  return (
    <div className="install-guide" role="dialog" aria-modal="true" aria-labelledby="install-guide-title" onClick={onClose}>
      <div className="install-guide__sheet" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="install-guide__close" aria-label="Закрыть" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="install-guide__app">
          {logo ? <img src={logo} alt="" width={56} height={56} /> : null}
          <span>
            <strong id="install-guide-title">{tenant.short_name}</strong>
            <span className="install-guide__sub">приложение на экране «Домой»</span>
          </span>
        </div>
        {inApp ? (
          <ol className="install-steps">
            <li>
              <span>
                Нажмите <b>⋯</b> в правом верхнем углу и выберите <b>«Открыть в браузере»</b>.
              </span>
            </li>
            <li>
              <span>В браузере снова нажмите «Добавить на экран „Домой“».</span>
            </li>
          </ol>
        ) : ios ? (
          <ol className="install-steps">
            <li>
              <span>
                Нажмите <Export size={20} weight="bold" className="install-steps__icon" aria-hidden="true" /> <b>«Поделиться»</b> в Safari. В новом
                Safari она прячется в меню <b>⋯</b> справа внизу.
              </span>
            </li>
            <li>
              <span>
                Выберите <PlusSquare size={20} weight="bold" className="install-steps__icon" aria-hidden="true" /> <b>«На экран „Домой“»</b> и нажмите
                «Добавить».
              </span>
            </li>
          </ol>
        ) : (
          <ol className="install-steps">
            <li>
              <span>
                Откройте меню браузера <b>⋮</b>.
              </span>
            </li>
            <li>
              <span>
                Выберите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.
              </span>
            </li>
          </ol>
        )}
        <p className="install-guide__note">Иконка {tenant.short_name} появится рядом с другими приложениями и будет открываться без адресной строки.</p>
      </div>
    </div>
  );
}

/** Small card on the home page: shown until the app is installed or the visitor hides it. */
export function InstallCard() {
  const { tenant } = useStudio();
  const st = useInstall();
  const key = 'install-card-hidden';
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  if (st.installed || hidden) return null;
  const logo = mediaUrl(tenant.logo_path);
  return (
    <section className="install-banner" aria-label="Установить приложение">
      {logo ? <img src={logo} alt="" width={44} height={44} className="install-banner__logo" /> : null}
      <span className="install-banner__text">
        <strong>Приложение {tenant.short_name}</strong>
        <span>Запись в одно касание с экрана «Домой»</span>
      </span>
      <button
        type="button"
        className="install-banner__hide"
        aria-label="Скрыть"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(key, '1');
          } catch {
            /* ignore */
          }
        }}
      >
        <X size={16} />
      </button>
      <span className="install-banner__action">
        <InstallButton label="Добавить на экран" />
      </span>
    </section>
  );
}
