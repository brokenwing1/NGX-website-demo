import { Heading } from '@astryxdesign/core';
import { AssistantChat } from '../components/AssistantChat';
import { useOwner } from './OwnerApp';

export function OwnerAssistant() {
  const { slug, settings } = useOwner();
  return (
    <main className="page page--plain page--chat owner-page">
      <div className="page__body">
        <header className="page__header">
          <Heading level={1}>Помощник</Heading>
        </header>
        <AssistantChat
          slug={slug}
          scope="owner"
          greeting={`Отвечаю по записям и деньгам «${settings.tenant.short_name}». Только читаю данные — изменения делайте в разделе «Записи».`}
          prompts={['Что у меня завтра?', 'Сколько машин было на неделе?', 'Сколько денег получено на неделе?']}
        />
      </div>
    </main>
  );
}
