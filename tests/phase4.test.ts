// Pruebas de fase 4: estado de la URL (sin navegador). node --test tests/
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_QUERY,
  membersAllowed,
  normalizeQuery,
  parseListQuery,
  sameQuery,
  toSearch,
} from "../src/lib/urlState.ts";
import type { ListQuery } from "../src/types.ts";

const q = (over: Partial<ListQuery> = {}): ListQuery => ({ ...DEFAULT_QUERY, ...over });

describe("urlState (fase 4)", () => {
  it("toSearch omite los valores por defecto", () => {
    assert.equal(toSearch(q()), "");
    assert.equal(toSearch(q({ channel: "@a" })), "?channel=%40a");
    assert.equal(
      toSearch(q({ channel: "@a", section: "shorts", sort_by: "popular", members: "only" })),
      "?channel=%40a&section=shorts&sort_by=popular&members=only",
    );
  });

  it("members solo aplica a videos y shorts", () => {
    assert.ok(membersAllowed("videos") && membersAllowed("shorts"));
    assert.ok(!membersAllowed("streams"));
    assert.equal(normalizeQuery(q({ section: "streams", members: "only" })).members, "all");
    assert.equal(toSearch(q({ channel: "@a", section: "streams", members: "public" })), "?channel=%40a&section=streams");
  });

  it("parse normaliza una URL inválida (streams + members=only)", () => {
    const p = parseListQuery("?channel=@a&section=live&members=only");
    assert.equal(p.section, "streams");
    assert.equal(p.members, "all");
  });

  it("round-trip: parse(toSearch(x)) == normalize(x)", () => {
    const cases = [
      q(),
      q({ channel: "@ASMRKittyKlaw", section: "shorts" }),
      q({ channel: "https://www.youtube.com/@x?a=1&b=2", sort_by: "oldest", members: "public" }),
      q({ channel: "UCabcdefghijklmnopqrstuv", section: "streams", members: "only" }),
      q({ channel: "  @espacios  " }),
    ];
    for (const c of cases) {
      assert.ok(sameQuery(parseListQuery(toSearch(c)), normalizeQuery(c)), JSON.stringify(c));
    }
  });

  it("aliases y valores raros caen al default; no hay prototype pollution", () => {
    assert.equal(parseListQuery("?section=short").section, "shorts");
    assert.equal(parseListQuery("?section=constructor").section, "videos");
    assert.equal(parseListQuery("?section=toString").section, "videos");
    assert.equal(parseListQuery("?sort_by=zzz&members=zzz").sort_by, "newest");
    assert.equal(parseListQuery("").channel, "");
  });

  it("normalizeQuery recorta el canal y devuelve el mismo objeto si no cambia", () => {
    const a = q({ channel: "@a" });
    assert.equal(normalizeQuery(a), a);
    assert.equal(normalizeQuery(q({ channel: " @a " })).channel, "@a");
  });

  it("sameQuery compara los 4 campos", () => {
    assert.ok(sameQuery(q(), q()));
    assert.ok(!sameQuery(q(), q({ sort_by: "popular" })));
    assert.ok(!sameQuery(q(), q({ channel: "@a" })));
  });
});
