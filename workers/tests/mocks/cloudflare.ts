/**
 * Mock Cloudflare KV and R2 bindings for testing
 */

export class MockKVNamespace implements KVNamespace {
  private store = new Map<string, { value: string; metadata?: unknown; expiration?: number }>();

  async get(key: string, options?: 'text'): Promise<string | null>;
  async get(key: string, options: 'json'): Promise<unknown>;
  async get(key: string, options: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  async get(key: string, options?: unknown): Promise<unknown> {
    const entry = this.store.get(key);
    if (!entry) return null;
    
    // Check expiration
    if (entry.expiration && Date.now() > entry.expiration) {
      this.store.delete(key);
      return null;
    }
    
    if (options === 'json') {
      return JSON.parse(entry.value);
    }
    if (options === 'arrayBuffer') {
      // Decode base64 to ArrayBuffer
      const binary = atob(entry.value);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }
    return entry.value;
  }

  async put(
    key: string, 
    value: string | ArrayBuffer | ArrayBufferView, 
    options?: KVNamespacePutOptions
  ): Promise<void> {
    let strValue: string;
    if (typeof value === 'string') {
      strValue = value;
    } else if (value instanceof ArrayBuffer) {
      // Encode ArrayBuffer as base64
      const bytes = new Uint8Array(value);
      strValue = btoa(String.fromCharCode(...bytes));
    } else {
      // ArrayBufferView
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      strValue = btoa(String.fromCharCode(...bytes));
    }
    
    let expiration: number | undefined;
    if (options?.expirationTtl) {
      expiration = Date.now() + options.expirationTtl * 1000;
    } else if (options?.expiration) {
      expiration = options.expiration * 1000;
    }
    
    this.store.set(key, { 
      value: strValue, 
      metadata: options?.metadata,
      expiration,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult<unknown, string>> {
    const keys: KVNamespaceListKey<unknown, string>[] = [];
    const prefix = options?.prefix || '';
    
    for (const [key, entry] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        keys.push({ 
          name: key, 
          metadata: entry.metadata,
          expiration: entry.expiration,
        });
      }
    }
    
    return {
      keys,
      list_complete: true,
      cacheStatus: null,
    };
  }

  async getWithMetadata<Metadata = unknown>(
    key: string, 
    options?: 'text' | 'json' | 'arrayBuffer' | KVNamespaceGetOptions<'text'>
  ): Promise<KVNamespaceGetWithMetadataResult<string, Metadata>> {
    const entry = this.store.get(key);
    if (!entry) return { value: null, metadata: null, cacheStatus: null };
    
    return { 
      value: entry.value, 
      metadata: entry.metadata as Metadata,
      cacheStatus: null,
    };
  }

  // Helper for tests
  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

export class MockR2Object implements R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  checksums: R2Checksums;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  range?: R2Range;
  storageClass: string;

  private data: ArrayBuffer;

  constructor(key: string, data: ArrayBuffer, metadata?: Record<string, string>) {
    this.key = key;
    this.data = data;
    this.version = '1';
    this.size = data.byteLength;
    this.etag = 'mock-etag';
    this.httpEtag = '"mock-etag"';
    this.checksums = {};
    this.uploaded = new Date();
    this.customMetadata = metadata;
    this.storageClass = 'Standard';
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data;
  }

  async text(): Promise<string> {
    const decoder = new TextDecoder();
    return decoder.decode(this.data);
  }

  async json<T>(): Promise<T> {
    return JSON.parse(await this.text());
  }

  async blob(): Promise<Blob> {
    return new Blob([this.data]);
  }

  writeHttpMetadata(_headers: Headers): void {}
}

export class MockR2Bucket implements R2Bucket {
  private store = new Map<string, { data: ArrayBuffer; metadata?: Record<string, string> }>();

  async head(key: string): Promise<R2Object | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return new MockR2Object(key, entry.data, entry.metadata);
  }

  async get(key: string, _options?: R2GetOptions): Promise<R2ObjectBody | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    
    const obj = new MockR2Object(key, entry.data, entry.metadata);
    return Object.assign(obj, {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(entry.data));
          controller.close();
        }
      }),
      bodyUsed: false,
    }) as R2ObjectBody;
  }

  async put(
    key: string, 
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, 
    options?: R2PutOptions
  ): Promise<R2Object> {
    let data: ArrayBuffer;
    
    if (value === null) {
      data = new ArrayBuffer(0);
    } else if (typeof value === 'string') {
      data = new TextEncoder().encode(value).buffer;
    } else if (value instanceof ArrayBuffer) {
      data = value;
    } else if (value instanceof Blob) {
      data = await value.arrayBuffer();
    } else if ('buffer' in value) {
      data = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    } else {
      // ReadableStream
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      data = result.buffer;
    }
    
    this.store.set(key, { data, metadata: options?.customMetadata });
    return new MockR2Object(key, data, options?.customMetadata);
  }

  async delete(keys: string | string[]): Promise<void> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    for (const key of keyArray) {
      this.store.delete(key);
    }
  }

  async list(_options?: R2ListOptions): Promise<R2Objects> {
    const objects = Array.from(this.store.entries()).map(([key, entry]) => 
      new MockR2Object(key, entry.data, entry.metadata)
    );
    return {
      objects,
      truncated: false,
      delimitedPrefixes: [],
    };
  }

  async createMultipartUpload(_key: string, _options?: R2MultipartOptions): Promise<R2MultipartUpload> {
    throw new Error('Not implemented');
  }

  async resumeMultipartUpload(_key: string, _uploadId: string): Promise<R2MultipartUpload> {
    throw new Error('Not implemented');
  }

  // Helper for tests
  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

// Type declarations for KV
interface KVNamespace {
  get(key: string, options?: 'text'): Promise<string | null>;
  get(key: string, options: 'json'): Promise<unknown>;
  get(key: string, options: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: KVNamespacePutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult<unknown, string>>;
  getWithMetadata<Metadata = unknown>(key: string, options?: unknown): Promise<KVNamespaceGetWithMetadataResult<string, Metadata>>;
}

interface KVNamespacePutOptions {
  expiration?: number;
  expirationTtl?: number;
  metadata?: unknown;
}

interface KVNamespaceListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

interface KVNamespaceListKey<Metadata, Key extends string = string> {
  name: Key;
  expiration?: number;
  metadata?: Metadata;
}

interface KVNamespaceListResult<Metadata, Key extends string = string> {
  keys: KVNamespaceListKey<Metadata, Key>[];
  list_complete: boolean;
  cursor?: string;
  cacheStatus: string | null;
}

interface KVNamespaceGetWithMetadataResult<Value, Metadata> {
  value: Value | null;
  metadata: Metadata | null;
  cacheStatus: string | null;
}

interface KVNamespaceGetOptions<T extends 'text' | 'json' | 'arrayBuffer' | 'stream'> {
  type?: T;
  cacheTtl?: number;
}

// Type declarations for R2
interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions): Promise<R2Object>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
  createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): Promise<R2MultipartUpload>;
}

interface R2GetOptions {
  onlyIf?: R2Conditional;
  range?: R2Range;
}

interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  md5?: ArrayBuffer | string;
  sha1?: ArrayBuffer | string;
  sha256?: ArrayBuffer | string;
  sha384?: ArrayBuffer | string;
  sha512?: ArrayBuffer | string;
  onlyIf?: R2Conditional;
  storageClass?: string;
}

interface R2ListOptions {
  limit?: number;
  prefix?: string;
  cursor?: string;
  delimiter?: string;
  include?: ('httpMetadata' | 'customMetadata')[];
  startAfter?: string;
}

interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  checksums: R2Checksums;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  range?: R2Range;
  storageClass: string;
  writeHttpMetadata(headers: Headers): void;
}

interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}

interface R2Checksums {
  md5?: ArrayBuffer;
  sha1?: ArrayBuffer;
  sha256?: ArrayBuffer;
  sha384?: ArrayBuffer;
  sha512?: ArrayBuffer;
}

interface R2HTTPMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

interface R2Range {
  offset?: number;
  length?: number;
  suffix?: number;
}

interface R2Conditional {
  etagMatches?: string;
  etagDoesNotMatch?: string;
  uploadedBefore?: Date;
  uploadedAfter?: Date;
  secondsGranularity?: boolean;
}

interface R2MultipartUpload {
  key: string;
  uploadId: string;
  uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob): Promise<R2UploadedPart>;
  abort(): Promise<void>;
  complete(uploadedParts: R2UploadedPart[]): Promise<R2Object>;
}

interface R2MultipartOptions {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  storageClass?: string;
}

interface R2UploadedPart {
  partNumber: number;
  etag: string;
}
