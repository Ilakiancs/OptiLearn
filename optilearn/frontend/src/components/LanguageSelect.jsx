/**
 * Grouped language <select> that respects the group field on each language
 * object returned by /api/feature1/languages.
 *
 * Groups:
 *   top      — English, shown first with no optgroup header
 *   refugee  — Refugee Camp Languages (UNHCR priority list)
 *   other    — All other languages, alphabetically sorted
 *
 * Falls back to a flat list when group information is absent (e.g. the
 * FALLBACK_LANGUAGES constant in HomeScreen that has no group field).
 *
 * Props:
 *   languages       array of language objects from the API
 *   value           controlled value
 *   onChange        change handler
 *   style           inline style for the <select>
 *   disabled        boolean
 *   includeAutoDetect  prepend an "Auto-detect" option (value="auto")
 *   format          "flag" (default) → "🇱🇰 Sinhala"
 *                   "code"           → "SI Sinhala"  (used in teacher views)
 */
export default function LanguageSelect({
  languages = [],
  value,
  onChange,
  style,
  disabled,
  includeAutoDetect,
  format = 'flag',
}) {
  const top     = languages.filter(l => l.group === 'top')
  const refugee = languages.filter(l => l.group === 'refugee')
  const other   = languages.filter(l => l.group === 'other')
  const hasGroups = refugee.length > 0 || other.length > 0

  function label(l) {
    if (format === 'code') return `${l.code.toUpperCase()} ${l.name}`
    return l.flag ? `${l.flag} ${l.name}` : l.name
  }

  return (
    <select value={value} onChange={onChange} style={style} disabled={disabled}>
      {includeAutoDetect && (
        <option value="auto">Auto-detect</option>
      )}
      {hasGroups ? (
        <>
          {top.map(l => (
            <option key={l.code} value={l.code}>{label(l)}</option>
          ))}
          {refugee.length > 0 && (
            <optgroup label="Common Languages">
              {refugee.map(l => (
                <option key={l.code} value={l.code}>{label(l)}</option>
              ))}
            </optgroup>
          )}
          {other.length > 0 && (
            <optgroup label="All Languages">
              {other.map(l => (
                <option key={l.code} value={l.code}>{label(l)}</option>
              ))}
            </optgroup>
          )}
        </>
      ) : (
        languages.map(l => (
          <option key={l.code} value={l.code}>{label(l)}</option>
        ))
      )}
    </select>
  )
}
