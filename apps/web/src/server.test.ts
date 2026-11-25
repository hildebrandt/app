import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  array,
  assert,
  asyncProperty,
  constant,
  constantFrom,
  oneof,
  option,
  string,
  tuple,
  uint8Array,
  uniqueArray,
} from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { setHeader } from "./server";

interface ExtraHeader {
  name: string;
  value: string;
}

interface ResponseCase {
  body: number[] | null;
  extras: ExtraHeader[];
  name: string;
  status: number;
  statusText: string;
  value: string;
}

const DEFAULT_RUNS = 100;

const DEFAULT_SEED = 20_261_125;

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

const PRINTABLE_ASCII = Array.from({ length: 95 }, (_, index) =>
  String.fromCodePoint(0x20 + index)
);

const NAME_CHARACTER = constantFrom(
  // oxlint-disable-next-line unicorn/prefer-spread
  ...Array.from(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~!#$%&'*+^`|"
  )
);

const VISIBLE_ASCII_CHARACTER = constantFrom(
  ...Array.from({ length: 94 }, (_, index) =>
    String.fromCodePoint(0x21 + index)
  )
);

const FIELD_VALUE_CHARACTER = constantFrom("\t", ...PRINTABLE_ASCII);

const EXTRA_HEADER_VALUE = oneof(
  constant(""),
  tuple(
    VISIBLE_ASCII_CHARACTER,
    string({ maxLength: 30, unit: FIELD_VALUE_CHARACTER }),
    VISIBLE_ASCII_CHARACTER
  ).map(([first, middle, last]) => `${first}${middle}${last}`)
);

const TARGET_VALUE_CHARACTER = constantFrom(
  // oxlint-disable-next-line unicorn/prefer-spread
  ...Array.from(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789;/=,._-:+!*'%()"
  )
);

const BODY_STATUS = constantFrom(
  200,
  201,
  202,
  203,
  206,
  207,
  301,
  302,
  303,
  307,
  308,
  400,
  401,
  403,
  404,
  409,
  418,
  422,
  429,
  451,
  500,
  502,
  503,
  599
);

const NULL_BODY_STATUS = constantFrom(204, 205, 304);

const HEADER_NAME = string({
  minLength: 1,
  maxLength: 24,
  unit: NAME_CHARACTER,
}).map((suffix) => `x-${suffix}`);

const EXTRA_HEADER = tuple(HEADER_NAME, EXTRA_HEADER_VALUE).map(
  ([name, value]) => ({ name, value })
);

const EXTRA_HEADERS = uniqueArray(EXTRA_HEADER, {
  maxLength: 4,
  selector: (header) => header.name.toLowerCase(),
});

const TARGET_VALUE = array(
  string({
    minLength: 1,
    maxLength: 8,
    unit: TARGET_VALUE_CHARACTER,
  }),
  { maxLength: 4 }
).map((words) => words.join(" "));

const RESPONSE_CASE = tuple(
  oneof(BODY_STATUS, NULL_BODY_STATUS),
  string({ maxLength: 24, unit: constantFrom(...PRINTABLE_ASCII) }),
  option(uint8Array({ maxLength: 64 }), { nil: null }),
  EXTRA_HEADERS,
  HEADER_NAME,
  TARGET_VALUE
).map(([status, statusText, body, extras, name, value]) => ({
  body: body === null || NULL_BODY_STATUSES.has(status) ? null : [...body],
  extras,
  name,
  status,
  statusText,
  value,
}));

const RUNS = Number(process.env.FC_RUNS ?? DEFAULT_RUNS);

const SEED = Number(process.env.FC_SEED ?? DEFAULT_SEED);

const REPLAY_PATH = process.env.FC_PATH;

const ASSERT_OPTIONS =
  REPLAY_PATH === undefined
    ? { numRuns: RUNS, seed: SEED }
    : { numRuns: RUNS, seed: SEED, path: REPLAY_PATH };

const responseFrom = (testCase: ResponseCase) => {
  const headers = new Headers();

  for (const { name, value } of testCase.extras) {
    headers.set(name, value);
  }

  return new Response(
    testCase.body === null ? null : Uint8Array.from(testCase.body),
    {
      status: testCase.status,
      statusText: testCase.statusText,
      headers,
    }
  );
};

const expectedHeaders = (input: Response, name: string, value: string) => {
  const expected = new Map(input.headers);

  expected.set(name.toLowerCase(), value);

  return expected;
};

const isAddressInfo = (
  value: string | AddressInfo | null
): value is AddressInfo => typeof value === "object" && value !== null;

const server = createServer((request, response) => {
  const chunks: string[] = [];

  request.setEncoding("utf-8");

  request.on("data", (chunk: string) => {
    chunks.push(chunk);
  });

  request.on("end", () => {
    // SAFETY: the test client is the only producer of these request bodies.
    const testCase = JSON.parse(chunks.join("")) as ResponseCase; // oxlint-disable-line typescript/no-unsafe-type-assertion
    const headers: Record<string, string> = {};

    for (const { name, value } of testCase.extras) {
      headers[name] = value;
    }

    response.writeHead(testCase.status, testCase.statusText, headers);

    response.end(
      testCase.body === null ? undefined : Buffer.from(testCase.body)
    );
  });
});

let baseUrl = "";

describe("setHeader response handling", () => {
  beforeAll(async () => {
    server.listen(0, "127.0.0.1");

    await once(server, "listening");

    const address = server.address();

    if (!isAddressInfo(address)) {
      throw new Error("test server did not bind to a TCP port");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    const closed = once(server, "close");

    server.close();

    await closed;
  });

  it("sets the target header and preserves the mutable response", async () => {
    await assert(
      asyncProperty(RESPONSE_CASE, async (testCase) => {
        const input = responseFrom(testCase);

        const expected = expectedHeaders(input, testCase.name, testCase.value);

        const result = setHeader(input, testCase.name, testCase.value);

        expect(result.headers.get(testCase.name)).toBe(testCase.value);

        expect([result.status, result.statusText]).toStrictEqual([
          input.status,
          input.statusText,
        ]);

        expect(new Map(result.headers)).toStrictEqual(expected);

        expect(new Uint8Array(await result.arrayBuffer())).toStrictEqual(
          Uint8Array.from(testCase.body ?? [])
        );

        expect(result).toBe(input);
      }),
      ASSERT_OPTIONS
    );
  });

  it("preserves the response through the immutable fallback", async () => {
    await assert(
      asyncProperty(RESPONSE_CASE, async (testCase) => {
        const input = await fetch(`${baseUrl}/respond`, {
          method: "POST",
          body: JSON.stringify(testCase),
          redirect: "manual",
        });

        expect(() => {
          input.headers.set("x-probe", "1");
        }).toThrow(/immutable/u);

        const expected = expectedHeaders(input, testCase.name, testCase.value);

        const result = setHeader(input, testCase.name, testCase.value);

        expect(result.headers.get(testCase.name)).toBe(testCase.value);

        expect([result.status, result.statusText]).toStrictEqual([
          input.status,
          input.statusText,
        ]);

        expect(new Map(result.headers)).toStrictEqual(expected);

        expect(new Uint8Array(await result.arrayBuffer())).toStrictEqual(
          Uint8Array.from(testCase.body ?? [])
        );
      }),
      ASSERT_OPTIONS
    );
  });
});
