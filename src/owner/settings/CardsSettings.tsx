import { Button, TextInput } from '@astryxdesign/core';
import { useState } from 'react';
import { CARD_ICONS, cardIcon } from '../../components/icons';
import { ownerApi } from '../../lib/api';
import { SelectField } from '../fields';
import { useOwner } from '../OwnerApp';
import { useOwnerMutation } from '../useOwnerMutation';

export function CardsSettings() {
  const { settings } = useOwner();
  const cards = [1, 2, 3].map((p) => settings.info_cards.find((c) => c.position === p) ?? { position: p, icon: 'Sparkle', title: '', body: '', source: 'owner' });
  return (
    <ul className="stack-3">
      {cards.map((c) => (
        <CardForm key={c.position} card={c} />
      ))}
    </ul>
  );
}

function CardForm({ card }: { card: { position: number; icon: string; title: string; body: string } }) {
  const { slug } = useOwner();
  const [icon, setIcon] = useState(card.icon);
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);
  const save = useOwnerMutation(() => ownerApi.updateInfoCard(slug, card.position, icon, title.trim(), body.trim()), { success: 'Карточка сохранена' });
  const Icon = cardIcon(icon);
  const dirty = icon !== card.icon || title !== card.title || body !== card.body;
  return (
    <li className="panel stack-3">
      <div className="card-preview">
        <Icon size={24} weight="duotone" className="accent-icon" aria-hidden="true" />
        <span>Карточка {card.position}</span>
      </div>
      <SelectField label="Иконка" value={icon} onChange={setIcon}>
        {Object.keys(CARD_ICONS).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </SelectField>
      <TextInput label="Заголовок" value={title} onChange={(v) => setTitle(v.slice(0, 40))} width="100%" />
      <TextInput label="Текст" value={body} onChange={(v) => setBody(v.slice(0, 160))} width="100%" />
      <Button label="Сохранить" variant="primary" isDisabled={!dirty || !title.trim()} isLoading={save.isPending} onClick={() => save.mutate(undefined)} width="100%" />
    </li>
  );
}
