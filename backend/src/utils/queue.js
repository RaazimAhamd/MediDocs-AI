/** Minimal promise queue with a fixed concurrency (keeps load low on 8 GB machines). */
export class TaskQueue {
  #running = 0;
  #pending = [];

  constructor(concurrency = 1) {
    this.concurrency = concurrency;
  }

  add(task) {
    return new Promise((resolve, reject) => {
      this.#pending.push({ task, resolve, reject });
      this.#drain();
    });
  }

  #drain() {
    while (this.#running < this.concurrency && this.#pending.length > 0) {
      const { task, resolve, reject } = this.#pending.shift();
      this.#running++;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          this.#running--;
          this.#drain();
        });
    }
  }

  get size() {
    return this.#pending.length + this.#running;
  }

  async idle(pollMs = 10) {
    while (this.size > 0) await new Promise((r) => setTimeout(r, pollMs));
  }
}
