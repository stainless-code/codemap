/** Bench slice: method calls stay in calls; phase-2 skips binding (see call-resolver). */
export class PingService {
  ping(): number {
    return 1;
  }

  run(): number {
    return this.ping();
  }
}
