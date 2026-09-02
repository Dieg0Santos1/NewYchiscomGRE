import type { AppConfig } from './env.js';

export type GreDefaults = Pick<AppConfig, 'remitente' | 'puntoPartida'>;

export function getGreDefaults(config: AppConfig): GreDefaults {
  return {
    remitente: config.remitente,
    puntoPartida: config.puntoPartida
  };
}
