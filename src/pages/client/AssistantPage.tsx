import { Heading } from '@astryxdesign/core';
import { ArrowLeft } from '@phosphor-icons/react';
import { Link, useSearchParams } from 'react-router';
import { useStudio } from '../../app/studio';
import { AssistantChat } from '../../components/AssistantChat';

export function AssistantPage() {
  const { slug, tenant, openBooking } = useStudio();
  const [search] = useSearchParams();
  const priced = tenant.services.find((s) => s.price_is_from) ?? tenant.services[0];
  return (
    <main className="page page--plain page--chat">
      <div className="page__body">
        <Link to={`/s/${slug}/`} className="back-link">
          <ArrowLeft size={18} aria-hidden="true" /> {tenant.short_name}
        </Link>
        <header className="page__header">
          <Heading level={1}>Помощник</Heading>
        </header>
        <AssistantChat
          slug={slug}
          scope="client"
          greeting={`Здравствуйте! Я помощник ${tenant.name}. Подскажу цены, свободное время и как к нам проехать.`}
          prompts={['Когда ближайшее окно?', priced ? `Сколько стоит ${priced.name.toLowerCase()}?` : 'Сколько стоят услуги?', 'Как найти студию?']}
          initialQuestion={search.get('q')}
          onSlot={(s) => openBooking({ serviceId: s.service_id, startsAt: s.starts_at })}
        />
      </div>
    </main>
  );
}
