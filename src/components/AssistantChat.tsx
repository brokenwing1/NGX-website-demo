// Assistant chat shared by clients and owners. Answers come from the server function, which always
// fetches real data (slots, prices, bookings, money) before replying. Booking itself never depends on AI.
import { ChatComposer, ChatMessage, ChatMessageBubble, ChatMessageList, ChatSystemMessage, Text } from '@astryxdesign/core';
import { CalendarCheck, ChatCircleDots, Info } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { askAssistant, type AssistantResponse } from '../lib/api';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  slots?: AssistantResponse['slots'];
  degraded?: boolean;
  error?: boolean;
}

export function AssistantChat({
  slug,
  scope,
  greeting,
  prompts,
  initialQuestion,
  onSlot,
}: {
  slug: string;
  scope: 'client' | 'owner';
  greeting: string;
  prompts: string[];
  initialQuestion?: string | null;
  onSlot?: (s: AssistantResponse['slots'][number]) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  const ask = useMutation({
    mutationFn: (history: Msg[]) =>
      askAssistant(
        slug,
        scope,
        history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
      ),
    onSuccess: (res) => setMessages((m) => [...m, { role: 'assistant', content: res.reply, slots: res.slots, degraded: res.degraded }]),
    onError: (e) => setMessages((m) => [...m, { role: 'assistant', content: (e as Error).message || 'Помощник недоступен', error: true }]),
  });

  const send = (text: string) => {
    const t = text.trim();
    if (!t || ask.isPending) return;
    const next = [...messages, { role: 'user' as const, content: t.slice(0, 1000) }];
    setMessages(next);
    setDraft('');
    ask.mutate(next.slice(-12));
  };

  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'end' });
  }, [messages.length, ask.isPending]);

  return (
    <div className="assistant">
      <ChatMessageList density="compact" isStreaming={ask.isPending} align="top">
        <ChatMessage sender="assistant">
          <ChatMessageBubble>{greeting}</ChatMessageBubble>
        </ChatMessage>
        {messages.length === 0 ? (
          <div className="prompt-chips prompt-chips--chat">
            {prompts.map((p) => (
              <button key={p} type="button" className="chip" onClick={() => send(p)}>
                <ChatCircleDots size={16} aria-hidden="true" />
                {p}
              </button>
            ))}
          </div>
        ) : null}
        {messages.map((m, i) => (
          <ChatMessage key={i} sender={m.role}>
            <ChatMessageBubble>
              <span className="assistant__text">{m.content}</span>
            </ChatMessageBubble>
            {m.slots?.length && onSlot ? (
              <div className="slot-suggestions" role="group" aria-label="Записаться на предложенное время">
                {m.slots.map((s) => (
                  <button key={`${s.service_id}-${s.starts_at}`} type="button" className="chip chip--accent" onClick={() => onSlot(s)}>
                    <CalendarCheck size={16} aria-hidden="true" />
                    {s.label}
                    <span className="chip__sub">{s.service_name}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {m.degraded ? (
              <Text type="supporting" color="secondary" display="block" className="assistant__note">
                <Info size={14} aria-hidden="true" /> Ответ собран из данных студии без AI.
              </Text>
            ) : null}
          </ChatMessage>
        ))}
        {ask.isPending ? <ChatSystemMessage>Смотрю данные студии…</ChatSystemMessage> : null}
        <div ref={endRef} />
      </ChatMessageList>
      <div className="assistant__composer">
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSubmit={send}
          placeholder={scope === 'owner' ? 'Например: что у меня завтра?' : 'Спросите про цены или время'}
          isDisabled={ask.isPending}
          density="compact"
        />
      </div>
    </div>
  );
}
