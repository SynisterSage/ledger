export class LensRequestRegistry<T> {
  private readonly requests = new Map<string, Promise<T>>();

  getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.requests.get(key);
    if (existing) return existing;
    const request = factory();
    this.requests.set(key, request);
    void request.then(
      () => { if (this.requests.get(key) === request) this.requests.delete(key); },
      () => { if (this.requests.get(key) === request) this.requests.delete(key); },
    );
    return request;
  }

  get size() {
    return this.requests.size;
  }
}
