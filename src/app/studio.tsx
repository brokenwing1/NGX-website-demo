import { createContext, useContext } from 'react';
import type { TenantPublic } from '../lib/api';

export interface BookingRequest {
  serviceId?: string;
  startsAt?: string;
}

export interface StudioCtx {
  slug: string;
  tenant: TenantPublic;
  openBooking: (req?: BookingRequest) => void;
  /** bump to refresh "Моя запись" counters after a booking/cancel */
  myBookingsVersion: number;
  bumpMyBookings: () => void;
}

export const StudioContext = createContext<StudioCtx | null>(null);

export function useStudio(): StudioCtx {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio outside StudioRoot');
  return ctx;
}
