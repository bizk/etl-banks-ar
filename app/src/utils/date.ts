import { parseISO } from 'date-fns';

/** Parse a calendar date without allowing timezone conversion to change its day. */
export function parseCalendarDate(value: string): Date {
  return parseISO(value.slice(0, 10));
}
