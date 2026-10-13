import { Button, TextArea, TextInput } from '@astryxdesign/core';
import { useState } from 'react';
import { StepHeader } from './StepHeader';

export interface Contacts {
  name: string;
  phone: string;
  car: string;
  comment: string;
}

export function normalizePhone(v: string): string | null {
  let d = v.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = `7${d.slice(1)}`;
  if (d.length === 10) d = `7${d}`;
  return d.length >= 10 && d.length <= 15 ? `+${d}` : null;
}

// Astryx inputs forward extra attributes to the <input>; these improve mobile keyboards & autofill.
const telAttrs = { inputMode: 'tel', enterKeyHint: 'next' } as Record<string, string>;
const nextAttrs = { enterKeyHint: 'next' } as Record<string, string>;

export function ContactsStep({ value, onChange, onBack, onNext }: { value: Contacts; onChange: (c: Contacts) => void; onBack: () => void; onNext: () => void }) {
  const [touched, setTouched] = useState(false);
  const errors = {
    name: value.name.trim().length === 0 ? 'Как к вам обращаться?' : null,
    phone: normalizePhone(value.phone) ? null : 'Номер нужен для связи, например +7 900 123-45-67',
    car: value.car.trim().length === 0 ? 'Марка и модель, например Kia Rio' : null,
  };
  const valid = !errors.name && !errors.phone && !errors.car;
  const set = (patch: Partial<Contacts>) => onChange({ ...value, ...patch });

  return (
    <form
      className="step"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid) onNext();
      }}
    >
      <StepHeader title="Ваши контакты" step={3} total={4} onBack={onBack} />
      <div className="stack-4">
        <TextInput
          label="Имя"
          value={value.name}
          onChange={(v) => set({ name: v })}
          autoComplete="name"
          isRequired
          width="100%"
          size="lg"
          status={touched && errors.name ? { type: 'error', message: errors.name } : undefined}
          {...nextAttrs}
        />
        <TextInput
          label="Телефон"
          value={value.phone}
          onChange={(v) => set({ phone: v })}
          autoComplete="tel"
          placeholder="+7 900 123-45-67"
          isRequired
          width="100%"
          size="lg"
          status={touched && errors.phone ? { type: 'error', message: errors.phone } : undefined}
          {...telAttrs}
        />
        <TextInput
          label="Автомобиль"
          value={value.car}
          onChange={(v) => set({ car: v })}
          placeholder="Марка и модель"
          isRequired
          width="100%"
          size="lg"
          status={touched && errors.car ? { type: 'error', message: errors.car } : undefined}
          {...nextAttrs}
        />
        <TextArea
          label="Комментарий"
          value={value.comment}
          onChange={(v) => set({ comment: v })}
          isOptional
          rows={2}
          maxLength={500}
          width="100%"
          placeholder="Например, цвет кузова или пожелания"
        />
      </div>
      <div className="step__footer">
        <Button type="submit" variant="primary" size="lg" label="Далее" width="100%" />
      </div>
    </form>
  );
}
