// -----------------------------------------------------------------------------
// User-facing texts, in the four languages of the integration (English,
// French, German, Spanish). Gladys picks the user's language from these
// multi-language objects, with English as the fallback.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Build a multi-language object from one function of the language. */
export function forEachLanguage(build) {
  return Object.fromEntries(LANGUAGES.map((lang) => [lang, build(lang)]));
}

/** "5 min ago", "3 h ago", "2 days ago"... from a number of minutes. */
export function ago(minutes) {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 1) {
    return { en: 'just now', fr: "à l'instant", de: 'gerade eben', es: 'ahora mismo' };
  }
  if (m < 60) {
    return { en: `${m} min ago`, fr: `il y a ${m} min`, de: `vor ${m} Min.`, es: `hace ${m} min` };
  }
  const h = Math.floor(m / 60);
  if (h < 48) {
    return { en: `${h} h ago`, fr: `il y a ${h} h`, de: `vor ${h} Std.`, es: `hace ${h} h` };
  }
  const d = Math.floor(h / 24);
  return {
    en: `${d} days ago`,
    fr: `il y a ${d} jours`,
    de: `vor ${d} Tagen`,
    es: `hace ${d} días`,
  };
}

/** A distance in meters, formatted in the unit system of the viewer. */
export function formatDistance(meters, units = 'metric') {
  if (units === 'us') {
    const miles = meters / 1609.344;
    return miles < 0.1 ? `${Math.round(meters * 3.28084)} ft` : `${miles.toFixed(1)} mi`;
  }
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export const TEXTS = {
  home: { en: 'Home', fr: 'Maison', de: 'Zuhause', es: 'Casa' },
  away: { en: 'Away', fr: 'Absent', de: 'Unterwegs', es: 'Fuera' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  lost: { en: 'Lost', fr: 'Perdu', de: 'Verloren', es: 'Perdido' },
  local: { en: 'Local', fr: 'Local', de: 'Lokal', es: 'Local' },
  cloud: { en: 'Cloud', fr: 'Cloud', de: 'Cloud', es: 'Nube' },
  charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
};
