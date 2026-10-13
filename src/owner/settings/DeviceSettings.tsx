import { Button, Text } from '@astryxdesign/core';
import { BellRinging, DownloadSimple } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { ownerApi } from '../../lib/api';
import { PUSH_REASON_TEXT, installPrompt, isIos, isStandalone, pushSupport, subscribePush } from '../../lib/pwa';
import { useOwner } from '../OwnerApp';

export function DeviceSettings() {
  const { slug, settings } = useOwner();
  const support = pushSupport();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canInstall, setCanInstall] = useState(installPrompt.available());
  useEffect(() => {
    const off = installPrompt.subscribe(() => setCanInstall(installPrompt.available()));
    return () => {
      off();
    };
  }, []);

  return (
    <div className="stack-4">
      <section className="panel stack-3">
        <h2 className="panel__title">Уведомления о новых записях</h2>
        {support.ok ? (
          <Button
            variant="primary"
            label="Включить на этом телефоне"
            icon={<BellRinging size={18} />}
            isLoading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const sub = await subscribePush(slug);
                const res = await ownerApi.savePush(slug, sub);
                setStatus(res.delivers ? 'Готово: пришлём уведомление о каждой онлайн-записи и отмене.' : 'Подписка сохранена. Студия в режиме образца — уведомления начнут приходить после запуска.');
              } catch (e) {
                setStatus((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <Text type="body" color="secondary" display="block">
            {PUSH_REASON_TEXT[support.reason]}
          </Text>
        )}
        {status ? (
          <Text type="supporting" color="secondary" display="block" role="status">
            {status}
          </Text>
        ) : null}
      </section>

      <section className="panel stack-3">
        <h2 className="panel__title">Приложение на экране телефона</h2>
        {isStandalone() ? (
          <Text type="body" color="secondary" display="block">
            Приложение уже установлено и открыто без адресной строки.
          </Text>
        ) : canInstall ? (
          <Button label="Установить приложение" icon={<DownloadSimple size={18} />} onClick={() => void installPrompt.prompt()} />
        ) : isIos() ? (
          <Text type="body" color="secondary" display="block">
            В Safari нажмите «Поделиться» → «На экран Домой». Иконка «{settings.tenant.short_name}» откроет кабинет без адресной строки.
          </Text>
        ) : (
          <Text type="body" color="secondary" display="block">
            Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».
          </Text>
        )}
      </section>
    </div>
  );
}
