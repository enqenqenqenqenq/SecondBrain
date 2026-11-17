import { useEffect, useRef, useState } from 'react'
import { describeEvent } from './storage'
import type { EventTime } from './storage'
import {
  MONTH_NAMES,
  PRECISIONS,
  SEASONS,
  changePrecision,
  draftFromEvent,
  eventFromDraft,
} from './timeDraft'
import type { TimeDraft } from './timeDraft'
import './TimeSheet.css'

function YearField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (year: number) => void
}) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="stepper">
        <button type="button" aria-label="Меньше" onClick={() => onChange(value - 1)}>
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          aria-label={label}
          value={value || ''}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <button type="button" aria-label="Больше" onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  )
}

// Окно «Время и точность»: выбрать точность, ввести значение, нажать «Готово»
export default function TimeSheet({
  event,
  now,
  onSave,
  onClose,
}: {
  event: EventTime
  now: Date
  onSave: (event: EventTime) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<TimeDraft>(() => draftFromEvent(event))

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  const set = (patch: Partial<TimeDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const built = eventFromDraft(draft)

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onClose={onClose}
      // Escape и нажатие на затемнённый фон закрывают окно через родителя, а не только средствами браузера
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        // Нажатие вне границ окна это нажатие на затемнённый фон. Нажатия на кнопки внутри не в счёт:
        // у них при управлении клавишей координаты нулевые, и окно закрывалось бы само.
        if (e.target !== ref.current) return
        const box = ref.current?.getBoundingClientRect()
        if (!box) return
        const outside =
          e.clientX < box.left ||
          e.clientX > box.right ||
          e.clientY < box.top ||
          e.clientY > box.bottom
        if (outside) onClose()
      }}
    >
      <div className="sheet-head">
        <h2 id="sheet-title">Время и точность</h2>
        <button type="button" className="link-button" onClick={onClose}>
          Отмена
        </button>
      </div>

      <div className="chips" role="group" aria-label="Точность">
        {PRECISIONS.map((p) => (
          <button
            key={p.value}
            type="button"
            className="choice"
            aria-pressed={draft.precision === p.value}
            onClick={() => setDraft((d) => changePrecision(d, p.value))}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="fields">
        {(draft.precision === 'minute' || draft.precision === 'day') && (
          <div className="row-fields">
            <label>
              <span className="field-label">Дата</span>
              <input
                type="date"
                value={draft.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </label>
            {draft.precision === 'minute' && (
              <label>
                <span className="field-label">Время</span>
                <input
                  type="time"
                  value={draft.time}
                  onChange={(e) => set({ time: e.target.value })}
                />
              </label>
            )}
          </div>
        )}

        {draft.precision === 'month' && (
          <>
            <label>
              <span className="field-label">Месяц</span>
              <select value={draft.month} onChange={(e) => set({ month: Number(e.target.value) })}>
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <YearField label="Год" value={draft.year} onChange={(year) => set({ year })} />
          </>
        )}

        {draft.precision === 'season' && (
          <>
            <div>
              <span className="field-label">Сезон</span>
              <div className="chips" role="group" aria-label="Сезон">
                {SEASONS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className="choice"
                    aria-pressed={draft.season === s.value}
                    onClick={() => set({ season: s.value })}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <YearField label="Год" value={draft.year} onChange={(year) => set({ year })} />
          </>
        )}

        {draft.precision === 'year' && (
          <YearField label="Год" value={draft.year} onChange={(year) => set({ year })} />
        )}

        {draft.precision === 'range' && (
          <div className="row-fields">
            <YearField
              label="С года"
              value={draft.fromYear}
              onChange={(fromYear) => set({ fromYear })}
            />
            <YearField label="По год" value={draft.toYear} onChange={(toYear) => set({ toYear })} />
          </div>
        )}
      </div>

      <p className="preview" role="status">
        {built ? describeEvent(built, now) : 'Проверь значения'}
      </p>
      <button
        type="button"
        className="primary done"
        disabled={!built}
        onClick={() => built && onSave(built)}
      >
        Готово
      </button>
    </dialog>
  )
}
