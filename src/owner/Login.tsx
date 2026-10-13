import { Banner, Button, Heading, Text, TextInput } from '@astryxdesign/core';
import { ArrowLeft, LockKey } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { DEMO } from '../lib/accent';

/** Demo build only: the owner login of each demo studio, so a viewer can open the cabinet in one tap. */
function demoLogin(slug: string): { email: string; password: string } | null {
  if (!DEMO) return null;
  try {
    const list = JSON.parse(import.meta.env.VITE_DEMO_STUDIOS ?? '[]') as { slug: string; email: string; password: string }[];
    return list.find((s) => s.slug === slug) ?? null;
  } catch {
    return null;
  }
}

export function Login({ studioName, onSignIn }: { studioName: string; onSignIn: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { slug = '' } = useParams();
  const demo = demoLogin(slug);
  return (
    <main className="page page--center owner-login">
      <Link to={`/s/${slug}/profile`} className="back-link owner-login__back">
        <ArrowLeft size={18} aria-hidden="true" /> Профиль
      </Link>
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!email || !password) {
            setError('Введите почту и пароль');
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await onSignIn(email, password);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <LockKey size={40} weight="duotone" className="accent-icon" aria-hidden="true" />
        <Heading level={1}>Кабинет владельца</Heading>
        <Text type="body" color="secondary" display="block">
          {studioName}
        </Text>
        <TextInput label="Почта" type="email" value={email} onChange={setEmail} autoComplete="username" width="100%" size="lg" />
        <TextInput label="Пароль" type="password" value={password} onChange={setPassword} autoComplete="current-password" width="100%" size="lg" />
        {error ? <Banner status="error" title={error} /> : null}
        <Button type="submit" variant="primary" size="lg" label="Войти" width="100%" isLoading={busy} />
        {demo ? (
          <Button
            variant="secondary"
            size="lg"
            label="Демо-вход владельца"
            width="100%"
            onClick={() => {
              setEmail(demo.email);
              setPassword(demo.password);
              void onSignIn(demo.email, demo.password).catch((err: Error) => setError(err.message));
            }}
          />
        ) : null}
        <Text type="supporting" color="secondary" display="block">
          Доступ выдаёт администратор при подключении студии. Регистрации здесь нет.
        </Text>
      </form>
    </main>
  );
}
