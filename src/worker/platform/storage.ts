/**
 * Object storage, matching the small slice of Fling's `storage` the app uses.
 *
 * Only `get` and `put` are called anywhere in this codebase, and both map
 * straight onto R2. The shapes are kept identical to what the call sites
 * already destructure — `arrayBuffer()` on a get, `{ contentType }` on a put —
 * so nothing in the app has to change.
 */

import { currentEnv } from "./context";

export interface StoragePutOptions {
  contentType?: string;
}

export interface StorageObject {
  key: string;
  size: number;
  contentType?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

const bucket = () => currentEnv().BUCKET;

export const storage = {
  async get(key: string): Promise<StorageObject | null> {
    const obj = await bucket().get(key);
    if (!obj) return null;
    return {
      key,
      size: obj.size,
      contentType: obj.httpMetadata?.contentType,
      arrayBuffer: () => obj.arrayBuffer(),
      text: () => obj.text(),
    };
  },

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream,
    options: StoragePutOptions = {},
  ): Promise<void> {
    await bucket().put(key, value as any, {
      httpMetadata: options.contentType ? { contentType: options.contentType } : undefined,
    });
  },

  async delete(key: string): Promise<void> {
    await bucket().delete(key);
  },

  async list(prefix?: string): Promise<{ keys: { key: string; size: number }[] }> {
    const res = await bucket().list({ prefix });
    return { keys: res.objects.map((o) => ({ key: o.key, size: o.size })) };
  },
};
