import { IconButton } from '@astryxdesign/core';
import { CaretLeft, X } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';

/** Header of a sheet step. Moves focus to the step title so screen readers announce each step. */
export function StepHeader({ title, step, total, onBack, onClose }: { title: string; step?: number; total?: number; onBack?: () => void; onClose?: () => void }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => ref.current?.focus({ preventScroll: true }), 80);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="step-header">
      {onBack ? <IconButton variant="ghost" label="Назад" icon={<CaretLeft size={20} />} onClick={onBack} /> : <span className="step-header__spacer" />}
      <div className="step-header__titles">
        {step && total ? (
          <span className="step-header__count">
            Шаг {step} из {total}
          </span>
        ) : null}
        <h2 ref={ref} tabIndex={-1} className="step-header__title">
          {title}
        </h2>
        {step && total ? (
          <span className="step-progress" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={`step-progress__bar${i < step ? ' is-done' : ''}`} />
            ))}
          </span>
        ) : null}
      </div>
      {onClose ? <IconButton variant="ghost" label="Закрыть" icon={<X size={20} />} onClick={onClose} /> : <span className="step-header__spacer" />}
    </div>
  );
}
