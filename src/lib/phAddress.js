import { regions, provinces, city_mun, barangays } from "phil-reg-prov-mun-brgy";

/**
 * Real PSGC-derived Philippine address data (phil-reg-prov-mun-brgy), not a
 * hand-typed or invented list. The checkout form only shows three levels —
 * Region, City/Municipality, Barangay — matching the reference it was built
 * from, so the province level is flattened away here: every city/
 * municipality across every province in a region is offered directly under
 * that region, rather than making the buyer pick a province first.
 */
export const PH_REGIONS = [...regions].sort((a, b) => a.name.localeCompare(b.name));

const provincesByRegion = new Map();
for (const province of provinces) {
  const list = provincesByRegion.get(province.reg_code) || [];
  list.push(province);
  provincesByRegion.set(province.reg_code, list);
}

const citiesByProvince = new Map();
for (const city of city_mun) {
  const list = citiesByProvince.get(city.prov_code) || [];
  list.push(city);
  citiesByProvince.set(city.prov_code, list);
}

const barangaysByCity = new Map();
for (const barangay of barangays) {
  const list = barangaysByCity.get(barangay.mun_code) || [];
  list.push(barangay);
  barangaysByCity.set(barangay.mun_code, list);
}

export function citiesInRegion(regionCode) {
  const provinceList = provincesByRegion.get(regionCode) || [];
  const seen = new Map();
  for (const province of provinceList) {
    for (const city of citiesByProvince.get(province.prov_code) || []) {
      seen.set(city.mun_code, city);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function barangaysInCity(munCode) {
  return [...(barangaysByCity.get(munCode) || [])].sort((a, b) => a.name.localeCompare(b.name));
}
