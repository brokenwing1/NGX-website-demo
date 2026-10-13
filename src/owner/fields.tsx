// Native date/time/select fields: the OS pickers are the most convenient on a phone.
import type { ReactNode } from 'react';

export function DateField({ label, value, onChange, min, max }: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  return (
    <label className="native-field">
      <span className="native-field__label">{label}</span>
      <input className="native-input" type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} required />
    </label>
  );
}

export function TimeField({ label, value, onChange, step = 300 }: { label: string; value: string; onChange: (v: string) => void; step?: number }) {
  return (
    <label className="native-field">
      <span className="native-field__label">{label}</span>
      <input className="native-input" type="time" value={value} step={step} onChange={(e) => onChange(e.target.value)} required />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="native-field">
      <span className="native-field__label">{label}</span>
      <select className="native-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
