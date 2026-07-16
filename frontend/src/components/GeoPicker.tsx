import React, { useState } from 'react';
import { api } from '../lib/api';
import SearchableSelect, { Option } from './SearchableSelect';

/**
 * Cascading Country → Region → City → (optional) Locality picker rendered as a
 * single form field. Emits the composed, human-readable location string
 * (e.g. "Nyamirambo, Nyarugenge, Kigali City, Rwanda") via onChange.
 *
 * On edit the previously-saved string is shown as the current value; the user
 * re-picks to change it (we don't reverse-geocode the string back into ids).
 */
export default function GeoPicker({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const [country, setCountry] = useState<Option | null>(null);
  const [region, setRegion] = useState<Option | null>(null);
  const [city, setCity] = useState<Option | null>(null);
  const [locality, setLocality] = useState<Option | null>(null);

  const qs = (s: string) => (s ? `?search=${encodeURIComponent(s)}` : '');
  const compose = (c: Option | null, r: Option | null, ci: Option | null, l: Option | null) =>
    [l?.label, ci?.label, r?.label, c?.label].filter(Boolean).join(', ');

  const fetchCountries = (s: string) =>
    api
      .get<Array<{ id: string; name: string; emoji?: string | null }>>(`/geo/countries${qs(s)}`)
      .then((r) => r.data.map((x) => ({ id: x.id, label: x.name, hint: x.emoji ?? undefined })));
  const fetchRegions = (s: string) =>
    country
      ? api
          .get<Array<{ id: string; name: string }>>(`/geo/countries/${country.id}/regions${qs(s)}`)
          .then((r) => r.data.map((x) => ({ id: x.id, label: x.name })))
      : Promise.resolve([] as Option[]);
  const fetchCities = (s: string) =>
    region
      ? api
          .get<Array<{ id: string; name: string; hasLocalities?: boolean }>>(`/geo/regions/${region.id}/cities${qs(s)}`)
          .then((r) => r.data.map((x) => ({ id: x.id, label: x.name, hasChildren: x.hasLocalities })))
      : Promise.resolve([] as Option[]);
  const fetchLocalities = (s: string) =>
    city
      ? api
          .get<Array<{ id: string; name: string }>>(`/geo/cities/${city.id}/localities${qs(s)}`)
          .then((r) => r.data.map((x) => ({ id: x.id, label: x.name })))
      : Promise.resolve([] as Option[]);

  return (
    <div className="space-y-2">
      {value && (
        <p className="text-[11px] text-brand-on-surface-variant">
          Current: <span className="font-semibold text-brand-primary">{value}</span>
        </p>
      )}
      <SearchableSelect
        value={country}
        onChange={(o) => { setCountry(o); setRegion(null); setCity(null); setLocality(null); onChange(compose(o, null, null, null)); }}
        fetchOptions={fetchCountries}
        placeholder="Select country"
      />
      <SearchableSelect
        value={region}
        onChange={(o) => { setRegion(o); setCity(null); setLocality(null); onChange(compose(country, o, null, null)); }}
        fetchOptions={fetchRegions}
        reloadKey={country?.id}
        disabled={!country}
        disabledText="Select a country first"
        placeholder="Select region / province"
      />
      <SearchableSelect
        value={city}
        onChange={(o) => { setCity(o); setLocality(null); onChange(compose(country, region, o, null)); }}
        fetchOptions={fetchCities}
        reloadKey={region?.id}
        disabled={!region}
        disabledText="Select a region first"
        placeholder="Select district / city"
      />
      {city?.hasChildren && (
        <SearchableSelect
          value={locality}
          onChange={(o) => { setLocality(o); onChange(compose(country, region, city, o)); }}
          fetchOptions={fetchLocalities}
          reloadKey={city?.id}
          placeholder="Select sector / area"
        />
      )}
    </div>
  );
}
