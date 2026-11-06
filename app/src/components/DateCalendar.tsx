import { useState } from 'react';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns';
import { es } from 'date-fns/locale';

interface DateCalendarProps {
  /** Selected date as YYYY-MM-DD. */
  value: string;
  onSelect: (value: string) => void;
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function toDate(value: string): Date {
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : new Date();
}

/** Month grid date picker (weeks start on Monday). Selecting a day calls onSelect immediately. */
export function DateCalendar({ value, onSelect }: DateCalendarProps) {
  const selected = toDate(value);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(selected));
  const today = new Date();

  const gridStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 });
  const days: Date[] = [];
  for (let day = gridStart; day <= gridEnd; day = addDays(day, 1)) {
    days.push(day);
  }

  const pick = (day: Date) => onSelect(format(day, 'yyyy-MM-dd'));

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setVisibleMonth((m) => subMonths(m, 1))}
          aria-label="Mes anterior"
          className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container"
        >
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <span className="font-headline font-bold capitalize text-on-surface">
          {format(visibleMonth, 'MMMM yyyy', { locale: es })}
        </span>
        <button
          type="button"
          onClick={() => setVisibleMonth((m) => addMonths(m, 1))}
          aria-label="Mes siguiente"
          className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container"
        >
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className="py-1 text-xs font-semibold text-on-surface-variant opacity-60">
            {weekday}
          </span>
        ))}
        {days.map((day) => {
          const isSelected = isSameDay(day, selected);
          const isToday = isSameDay(day, today);
          const inMonth = isSameMonth(day, visibleMonth);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => pick(day)}
              aria-pressed={isSelected}
              aria-label={format(day, "d 'de' MMMM yyyy", { locale: es })}
              className={`flex h-10 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                isSelected
                  ? 'bg-primary-container font-bold text-white'
                  : isToday
                    ? 'text-primary ring-1 ring-inset ring-primary hover:bg-surface-container'
                    : inMonth
                      ? 'text-on-surface hover:bg-surface-container'
                      : 'text-on-surface-variant opacity-40 hover:bg-surface-container'
              }`}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex gap-2">
        {[
          { label: 'Hoy', day: today },
          { label: 'Ayer', day: subDays(today, 1) },
        ].map(({ label, day }) => (
          <button
            key={label}
            type="button"
            onClick={() => pick(day)}
            className="rounded-full bg-surface-container-low px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
