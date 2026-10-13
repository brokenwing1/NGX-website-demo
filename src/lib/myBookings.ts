// "Моя запись": the client keeps capability links to their own bookings on this device.
// Each entry is {id, token}; the token grants access to exactly one booking (server stores only its hash).
export interface SavedBooking {
  id: string;
  token: string;
  startsAt: string;
  serviceName: string;
  savedAt: string;
}

const key = (slug: string) => `my-bookings:${slug}`;

function read(slug: string): SavedBooking[] {
  try {
    const raw = localStorage.getItem(key(slug));
    const list = raw ? (JSON.parse(raw) as SavedBooking[]) : [];
    return Array.isArray(list) ? list.filter((b) => b && typeof b.id === 'string' && typeof b.token === 'string') : [];
  } catch {
    return [];
  }
}

function write(slug: string, list: SavedBooking[]) {
  try {
    localStorage.setItem(key(slug), JSON.stringify(list.slice(0, 30)));
  } catch {
    /* storage full or blocked: the booking link still works */
  }
}

export const myBookings = {
  list: read,
  get: (slug: string, id: string) => read(slug).find((b) => b.id === id),
  save(slug: string, b: Omit<SavedBooking, 'savedAt'>) {
    const rest = read(slug).filter((x) => x.id !== b.id);
    write(slug, [{ ...b, savedAt: new Date().toISOString() }, ...rest]);
  },
  remove(slug: string, id: string) {
    write(
      slug,
      read(slug).filter((x) => x.id !== id),
    );
  },
};

/** Shareable link to one booking. The token lives in the fragment, so it never reaches server logs. */
export function bookingLink(slug: string, id: string, token: string): string {
  return `${location.origin}/s/${slug}/my/${id}#t=${encodeURIComponent(token)}`;
}

// Contacts typed last time (convenience only).
const CONTACTS = 'client-contacts';
export function loadContacts(): { name: string; phone: string; car: string } {
  try {
    const v = JSON.parse(localStorage.getItem(CONTACTS) ?? '{}') as Partial<{ name: string; phone: string; car: string }>;
    return { name: v.name ?? '', phone: v.phone ?? '', car: v.car ?? '' };
  } catch {
    return { name: '', phone: '', car: '' };
  }
}
export function saveContacts(c: { name: string; phone: string; car: string }) {
  try {
    localStorage.setItem(CONTACTS, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
