import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { ZodType } from "zod";

// Web and worker share one filesystem and the same process-safe lock.
export class JsonFileStore<T> {
  constructor(
    readonly file: string,
    private readonly schema: ZodType<T>,
    private readonly initial: () => T,
  ) {}
  read<R>(action: (state: T) => R | Promise<R>) {
    return this.transaction(action, false);
  }
  update<R>(action: (state: T) => R | Promise<R>) {
    return this.transaction(action, true);
  }
  private async transaction<R>(
    action: (state: T) => R | Promise<R>,
    persist: boolean,
  ): Promise<R> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.file, {
      realpath: false,
      stale: 10000,
      update: 4000,
      retries: { retries: 60, minTimeout: 20, maxTimeout: 300 },
    });
    const temporary = this.file + "." + randomUUID() + ".tmp";
    try {
      const text = await readFile(this.file, "utf8").catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      });
      let state: T;
      try {
        state = this.schema.parse(
          text === null ? this.initial() : JSON.parse(text),
        );
      } catch (cause) {
        throw new Error(
          "The local workspace file is invalid. Restore a backup before continuing.",
          { cause },
        );
      }
      const result = await action(state);
      if (persist || text === null) {
        const document = JSON.stringify(this.schema.parse(state));
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(document);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, this.file);
        const directory = await open(path.dirname(this.file), "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
      return result;
    } finally {
      await rm(temporary, { force: true });
      await release();
    }
  }
}
