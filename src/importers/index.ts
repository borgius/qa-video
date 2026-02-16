import { ImportDriver } from './types.js';
import { apkgDriver } from './apkg.js';
import { brainscapeDriver } from './brainscape.js';
import { remnoteDriver } from './remnote.js';
import { knowtDriver } from './knowt.js';
import { gizmoDriver } from './gizmo.js';
import { mochiDriver } from './mochi.js';

export type { ImportDriver, ImportResult } from './types.js';

/** All registered import drivers keyed by name */
const drivers = new Map<string, ImportDriver>();

function register(driver: ImportDriver, ...aliases: string[]) {
  drivers.set(driver.name, driver);
  for (const ext of driver.extensions) {
    const alias = ext.replace(/^\./, '');
    if (!drivers.has(alias)) {
      drivers.set(alias, driver);
    }
  }
  for (const alias of aliases) {
    drivers.set(alias, driver);
  }
}

// -- register built-in drivers --
register(apkgDriver, 'anki');
register(brainscapeDriver);
register(remnoteDriver, 'rem');
register(knowtDriver, 'quizlet');
register(gizmoDriver);
register(mochiDriver);

/** Look up a driver by name, alias, or file extension */
export function getDriver(name: string): ImportDriver | undefined {
  return drivers.get(name);
}

/** List all unique drivers (deduplicated) */
export function listDrivers(): ImportDriver[] {
  return [...new Set(drivers.values())];
}

/** Supported --from values for CLI help */
export function driverNames(): string[] {
  return [...drivers.keys()];
}
