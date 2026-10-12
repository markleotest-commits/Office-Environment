import type { World } from './world';
export function localPhase(date: Date) {
  const hour = date.getHours() + date.getMinutes() / 60;
  return {
    hour,
    phase:
      hour < 6 || hour >= 19
        ? 'Night session'
        : hour < 8 || hour >= 17
          ? 'Golden hour'
          : 'Day session',
  };
}
export function weatherName(code: number) {
  return code === 0
    ? 'Clear'
    : code <= 3
      ? 'Overcast'
      : code === 45 || code === 48
        ? 'Fog'
        : (code >= 71 && code <= 77) || code === 85 || code === 86
          ? 'Snow'
          : 'Rain';
}
export class Atmosphere {
  private weather = 'Not connected';
  private fetched = 0;
  private coordinates: { latitude: number; longitude: number } | null = null;
  private busy = false;
  constructor(private world: World | null) {
    document
      .getElementById('weather-connect')!
      .addEventListener('click', () => {
        if (!navigator.geolocation) {
          this.status('Location unavailable in this browser.');
          return;
        }
        this.status('Waiting for location permission…');
        navigator.geolocation.getCurrentPosition(
          (p) => {
            this.coordinates = {
              latitude: Math.round(p.coords.latitude * 100) / 100,
              longitude: Math.round(p.coords.longitude * 100) / 100,
            };
            void this.refresh();
          },
          () =>
            this.status(
              'Location declined. Local-time lighting stays active; weather is off.',
            ),
          { timeout: 15000, maximumAge: 300000 },
        );
      });
    this.tick();
  }
  private status(text: string) {
    document.getElementById('weather-status')!.textContent = text;
  }
  private async refresh() {
    if (!this.coordinates || this.busy) return;
    this.busy = true;
    try {
      const { latitude, longitude } = this.coordinates;
      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`,
        { signal: AbortSignal.timeout(12000) },
      );
      if (!response.ok) throw Error();
      const data = await response.json();
      if (
        !Number.isFinite(data.current?.weather_code) ||
        !Number.isFinite(data.current?.temperature_2m)
      )
        throw Error();
      this.weather = weatherName(data.current.weather_code);
      this.status(
        `${this.weather} · ${Math.round(data.current.temperature_2m)}°C · Open-Meteo · updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      );
    } catch {
      this.weather = 'Not connected';
      this.status('Weather unavailable. Local-time lighting remains active.');
    } finally {
      this.fetched = Date.now();
      this.busy = false;
    }
  }
  tick() {
    const date = new Date(),
      { hour, phase } = localPhase(date);
    document.getElementById('local-time')!.textContent =
      `${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${phase}`;
    this.world?.setAtmosphere(hour, this.weather);
    if (this.coordinates && Date.now() - this.fetched > 15 * 60 * 1000)
      void this.refresh();
  }
}
