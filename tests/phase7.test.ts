// Fase 7: embed en modal (lógica pura).
import assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { canEmbed, embedUrl, isPlainClick, videoIdOf } from "../src/lib/embed.ts";

const ID = "cjFZfyjyADE";
describe("embed", () => {
  it("videoIdOf: usa id válido; si no, lo saca de la URL (watch, shorts, live)", () => {
    assert.equal(videoIdOf({ id: ID, url: "x" }), ID);
    assert.equal(videoIdOf({ id: "raro", url: `https://www.youtube.com/shorts/${ID}` }), ID);
    assert.equal(videoIdOf({ id: "raro", url: `https://www.youtube.com/watch?v=${ID}&t=5` }), ID);
    assert.equal(videoIdOf({ id: "raro", url: `https://www.youtube.com/live/${ID}` }), ID);
    assert.equal(videoIdOf({ id: "raro", url: "no es url" }), null);
  });
  it("no deja pasar ids con caracteres peligrosos", () => {
    assert.equal(videoIdOf({ id: 'a"><script>x', url: "https://youtube.com/" }), null);
    assert.equal(embedUrl({ id: "../../evil", url: "https://youtube.com/" }), null);
  });
  it("embedUrl: dominio nocookie, autoplay y sin relacionados", () => {
    const u = new URL(embedUrl({ id: ID, url: "" })!);
    assert.equal(u.origin, "https://www.youtube-nocookie.com");
    assert.equal(u.pathname, `/embed/${ID}`);
    assert.equal(u.searchParams.get("autoplay"), "1");
    assert.equal(u.searchParams.get("rel"), "0");
  });
  it("canEmbed: false para solo-miembros o sin id", () => {
    assert.equal(canEmbed({ id: ID, url: "" }, { members: "all" }), true);
    assert.equal(canEmbed({ id: ID, url: "" }, { members: "public" }), true);
    assert.equal(canEmbed({ id: ID, url: "" }, { members: "only" }), false);
    assert.equal(canEmbed({ id: "x", url: "y" }, { members: "all" }), false);
  });
  it("isPlainClick: solo clic izquierdo sin modificadores", () => {
    const base = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
    assert.equal(isPlainClick(base), true);
    assert.equal(isPlainClick({ ...base, ctrlKey: true }), false);
    assert.equal(isPlainClick({ ...base, metaKey: true }), false);
    assert.equal(isPlainClick({ ...base, button: 1 }), false);
  });
});
