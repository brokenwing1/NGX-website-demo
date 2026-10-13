import { Button, Heading, Text } from '@astryxdesign/core';
import { CarProfile, MagnifyingGlass } from '@phosphor-icons/react';
import { Navigate, useNavigate } from 'react-router';
import { DEMO, demoStartPath } from '../lib/accent';

/** Shared root page: no studio branding here — each studio lives at /s/<slug>/. */
export function RootLanding() {
  if (DEMO) return <Navigate to={demoStartPath()} replace />;
  return (
    <main className="page page--center root-landing">
      <CarProfile size={56} weight="duotone" aria-hidden="true" className="accent-icon" />
      <Heading level={1}>Онлайн-запись в автосервис</Heading>
      <Text type="body" color="secondary" display="block">
        Откройте ссылку, которую прислала ваша студия. Она выглядит так: <code>/s/название-студии/</code>
      </Text>
    </main>
  );
}

export function NotFound({ title = 'Страница не найдена' }: { title?: string }) {
  const navigate = useNavigate();
  return (
    <main className="page page--center">
      <MagnifyingGlass size={48} weight="duotone" aria-hidden="true" className="muted-icon" />
      <Heading level={1}>{title}</Heading>
      <Text type="body" color="secondary" display="block">
        Проверьте ссылку или вернитесь назад.
      </Text>
      <Button label="Назад" onClick={() => navigate(-1)} />
    </main>
  );
}
