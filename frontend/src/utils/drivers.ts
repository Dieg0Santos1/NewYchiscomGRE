import type { DriverCatalogItem } from '../types/gre';

export function driverIdentity(driver: DriverCatalogItem) {
  return [driver.tipoDocumento, driver.numeroDocumento, driver.licencia]
    .map((value) => value.trim().toUpperCase())
    .join('|');
}

export function uniqueDrivers(drivers: DriverCatalogItem[]) {
  const seen = new Set<string>();

  return drivers.filter((driver) => {
    const identity = driverIdentity(driver);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function driverPlates(drivers: DriverCatalogItem[], identity: string) {
  return [...new Set(
    drivers
      .filter((driver) => driverIdentity(driver) === identity)
      .map((driver) => driver.placa.trim().toUpperCase())
      .filter(Boolean)
  )];
}
